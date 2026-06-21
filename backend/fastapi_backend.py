from contextlib import contextmanager
import os
from fastapi import FastAPI, HTTPException
import psycopg2
import psycopg2.pool


### General setup

# API setup

app = FastAPI()
subapi = FastAPI()
app.mount("/api", subapi)

# This allows requests towards your API from frontend websites not served from the same host as this backend.
# Access from non-browser clients is always possible. You want this when you run the front- and backend in separate
# webservers using different ports of your developer machine.
# If you want to turn this on in production, read up on CORS and the Cross-Site Request Forgery attacks it's meant to
# prevent.

from fastapi.middleware.cors import CORSMiddleware

origins = [
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"]
)

@subapi.get("/")
async def version():
    '''Get API version'''
    return "0.1"


# Database setup


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


DB_HOST = os.getenv("TIMESTABLE_DB_HOST", "localhost")
DB_NAME = os.getenv("TIMESTABLE_DB_NAME", "timestable")
DB_USER = os.getenv("TIMESTABLE_DB_USER", "timestable")
DB_PASSWORD = _required_env("TIMESTABLE_DB_PASSWORD")
DB_PORT = int(os.getenv("TIMESTABLE_DB_PORT", "5432"))
DB_OPTIONS = os.getenv("TIMESTABLE_DB_OPTIONS", "-c timezone=UTC")

dbpool = psycopg2.pool.ThreadedConnectionPool(
    1,
    4,
    database=DB_NAME,
    host=DB_HOST,
    user=DB_USER,
    password=DB_PASSWORD,
    port=DB_PORT,
    options=DB_OPTIONS
)

@contextmanager
def db_cursor():
    conn = dbpool.getconn()
    try:
        with conn.cursor() as cur:
            yield cur
            conn.commit()
    except:
        conn.rollback()
        raise
    finally:
        dbpool.putconn(conn)


## API

OPAQUE_ID_BYTE_LENGTH = 8

# Base58 Alphabet (Bitcoin standard: no 0, O, I, l)
B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def _base58_fixed_length_for_bytes(byte_length: int) -> int:
    """Return the fixed Base58 string length needed to represent any `byte_length` bytes.

    Smallest k such that 58^k >= 256^byte_length.
    """

    if byte_length <= 0:
        raise ValueError("byte_length must be positive")

    target = 256 ** byte_length
    k = 1
    cap = 58
    while cap < target:
        cap *= 58
        k += 1
    return k

def base58_encode(data_bytes: bytes) -> str:
    """Encode bytes into a fixed-length Base58 string.

    The length is determined by the number of input bytes, so 5 bytes -> 7 chars,
    8 bytes -> 11 chars, etc.
    """

    fixed_length = _base58_fixed_length_for_bytes(len(data_bytes))

    num = int.from_bytes(data_bytes, byteorder='big')
    res = ""
    while num > 0:
        num, i = divmod(num, 58)
        res = B58_ALPHABET[i] + res

    if len(res) > fixed_length:
        raise ValueError("Input bytes do not fit into expected fixed-length Base58")

    return ("1" * (fixed_length - len(res))) + res

def base58_decode(b58_string: str, *, expected_length: int) -> bytes:
    """Decode a fixed-length Base58 string into exactly `expected_length` bytes."""

    num = 0
    for char in b58_string:
        num *= 58
        num += B58_ALPHABET.index(char)

    if num >= 256 ** expected_length:
        raise ValueError("Decoded Base58 value does not fit into expected_length")

    return num.to_bytes(expected_length, byteorder='big')

@subapi.get('/id')
async def get_new_child_id():
    '''Get a new child ID'''
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                INSERT INTO children DEFAULT VALUES
                RETURNING id_obfuscated
                '''
            )
            id_obfuscated = cur.fetchone()[0]
            id_obfuscated_b58 = base58_encode(id_obfuscated)
    except Exception as e:
        print(cur.query)
        print(cur.statusmessage)
        raise HTTPException(status_code=500, detail=str(e))
    return {"child_id": id_obfuscated_b58}


def deobfuscate_id(obfuscated_id_b58: str) -> int:
    obfuscated_id = base58_decode(obfuscated_id_b58, expected_length=OPAQUE_ID_BYTE_LENGTH)
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT id_transparent
                FROM children
                WHERE id_obfuscated = %s
                ''',
                (obfuscated_id,)
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError("No such child ID")
            transparent_id = row[0]
    except Exception as e:
        print(cur.query)
        print(cur.statusmessage)
        raise HTTPException(status_code=500, detail=str(e))
    return transparent_id


@subapi.get('/timestable/progress/{child_id_obfuscated}')
async def get_progress(child_id_obfuscated: str):
    '''Get progress for a child'''
    child_id_transparent = deobfuscate_id(child_id_obfuscated)
    res = None
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT COALESCE(JSON_AGG(q ORDER BY q.question_id), '[]'::json)
                FROM (
                  SELECT
                    question_id,
                    JSON_AGG(
                      JSON_BUILD_OBJECT(
                        'correct', correct,
                        'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                      )
                      ORDER BY answered_at DESC
                    ) AS answers
                  FROM (
                    SELECT
                      question_id, correct, answered_at,
                      ROW_NUMBER() OVER (
                        PARTITION BY child_id_transparent, question_id
                        ORDER BY answered_at DESC
                      ) AS rn
                    FROM answers_timestable
                    WHERE child_id_transparent = %s
                  ) t
                  WHERE rn <= 20
                  GROUP BY question_id
                ) q;
                ''',
                (child_id_transparent,)
            )
            res = cur.fetchone()[0]
    except Exception as e:
        print(cur.query)
        print(cur.statusmessage)
        raise HTTPException(status_code=500, detail=str(e))
    return res


@subapi.post('/timestable/answer')
async def store_answer(child_id_obfuscated: str, question_id: int, correct: bool):
    '''Store an answer'''
    print(f"Storing answer: child_id_obfuscated={child_id_obfuscated}, question_id={question_id}, correct={correct}")
    child_id_transparent = deobfuscate_id(child_id_obfuscated)
    print(f"Deobfuscated child_id: {child_id_transparent}")
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                INSERT INTO answers_timestable (child_id_transparent, question_id, correct)
                VALUES (%s, %s, %s)
                ''',
                (child_id_transparent, question_id, correct)
            )
    except Exception as e:
        print(cur.query)
        print(cur.statusmessage)
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success"}


@subapi.get('/timestable-equations/progress/{child_id_obfuscated}')
async def get_progress_equations(child_id_obfuscated: str):
        '''Get progress for a child (timestable equations)'''
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        res = None
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                SELECT COALESCE(JSON_AGG(q ORDER BY q.question_id), '[]'::json)
                                FROM (
                                    SELECT
                                        question_id,
                                        JSON_AGG(
                                            JSON_BUILD_OBJECT(
                                                'correct', correct,
                                                'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                            )
                                            ORDER BY answered_at DESC
                                        ) AS answers
                                    FROM (
                                        SELECT
                                            question_id, correct, answered_at,
                                            ROW_NUMBER() OVER (
                                                PARTITION BY child_id_transparent, question_id
                                                ORDER BY answered_at DESC
                                            ) AS rn
                                        FROM answers_timestable_equations
                                        WHERE child_id_transparent = %s
                                    ) t
                                    WHERE rn <= 20
                                    GROUP BY question_id
                                ) q;
                                ''',
                                (child_id_transparent,)
                        )
                        res = cur.fetchone()[0]
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return res


@subapi.post('/timestable-equations/answer')
async def store_answer_equations(child_id_obfuscated: str, question_id: int, correct: bool):
        '''Store an answer (timestable equations)'''
        print(f"Storing answer: child_id_obfuscated={child_id_obfuscated}, question_id={question_id}, correct={correct}")
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        print(f"Deobfuscated child_id: {child_id_transparent}")
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                INSERT INTO answers_timestable_equations (child_id_transparent, question_id, correct)
                                VALUES (%s, %s, %s)
                                ''',
                                (child_id_transparent, question_id, correct)
                        )
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return {"status": "success"}


@subapi.get('/plustable/progress/{child_id_obfuscated}')
async def get_progress_plustable(child_id_obfuscated: str):
        '''Get progress for a child (plustable)'''
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        res = None
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                SELECT COALESCE(JSON_AGG(q ORDER BY q.question_id), '[]'::json)
                                FROM (
                                    SELECT
                                        question_id,
                                        JSON_AGG(
                                            JSON_BUILD_OBJECT(
                                                'correct', correct,
                                                'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                            )
                                            ORDER BY answered_at DESC
                                        ) AS answers
                                    FROM (
                                        SELECT
                                            question_id, correct, answered_at,
                                            ROW_NUMBER() OVER (
                                                PARTITION BY child_id_transparent, question_id
                                                ORDER BY answered_at DESC
                                            ) AS rn
                                        FROM answers_plustable
                                        WHERE child_id_transparent = %s
                                    ) t
                                    WHERE rn <= 20
                                    GROUP BY question_id
                                ) q;
                                ''',
                                (child_id_transparent,)
                        )
                        res = cur.fetchone()[0]
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return res


@subapi.post('/plustable/answer')
async def store_answer_plustable(child_id_obfuscated: str, question_id: int, correct: bool):
        '''Store an answer (plustable)'''
        print(f"Storing answer: child_id_obfuscated={child_id_obfuscated}, question_id={question_id}, correct={correct}")
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        print(f"Deobfuscated child_id: {child_id_transparent}")
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                INSERT INTO answers_plustable (child_id_transparent, question_id, correct)
                                VALUES (%s, %s, %s)
                                ''',
                                (child_id_transparent, question_id, correct)
                        )
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return {"status": "success"}


@subapi.get('/plustable-equations/progress/{child_id_obfuscated}')
async def get_progress_plustable_equations(child_id_obfuscated: str):
        '''Get progress for a child (plustable equations)'''
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        res = None
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                SELECT COALESCE(JSON_AGG(q ORDER BY q.question_id), '[]'::json)
                                FROM (
                                    SELECT
                                        question_id,
                                        JSON_AGG(
                                            JSON_BUILD_OBJECT(
                                                'correct', correct,
                                                'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                            )
                                            ORDER BY answered_at DESC
                                        ) AS answers
                                    FROM (
                                        SELECT
                                            question_id, correct, answered_at,
                                            ROW_NUMBER() OVER (
                                                PARTITION BY child_id_transparent, question_id
                                                ORDER BY answered_at DESC
                                            ) AS rn
                                        FROM answers_plustable_equations
                                        WHERE child_id_transparent = %s
                                    ) t
                                    WHERE rn <= 20
                                    GROUP BY question_id
                                ) q;
                                ''',
                                (child_id_transparent,)
                        )
                        res = cur.fetchone()[0]
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return res


@subapi.post('/plustable-equations/answer')
async def store_answer_plustable_equations(child_id_obfuscated: str, question_id: int, correct: bool):
        '''Store an answer (plustable equations)'''
        print(f"Storing answer: child_id_obfuscated={child_id_obfuscated}, question_id={question_id}, correct={correct}")
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        print(f"Deobfuscated child_id: {child_id_transparent}")
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                INSERT INTO answers_plustable_equations (child_id_transparent, question_id, correct)
                                VALUES (%s, %s, %s)
                                ''',
                                (child_id_transparent, question_id, correct)
                        )
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return {"status": "success"}


@subapi.get('/division-remainder/progress/{child_id_obfuscated}')
async def get_progress_division_remainder(child_id_obfuscated: str):
        '''Get progress for a child (division remainder)'''
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        res = None
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                SELECT COALESCE(JSON_AGG(q ORDER BY q.question_id), '[]'::json)
                                FROM (
                                    SELECT
                                        question_id,
                                        JSON_AGG(
                                            JSON_BUILD_OBJECT(
                                                'correct', correct,
                                                'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                            )
                                            ORDER BY answered_at DESC
                                        ) AS answers
                                    FROM (
                                        SELECT
                                            question_id, correct, answered_at,
                                            ROW_NUMBER() OVER (
                                                PARTITION BY child_id_transparent, question_id
                                                ORDER BY answered_at DESC
                                            ) AS rn
                                        FROM answers_division_remainder
                                        WHERE child_id_transparent = %s
                                    ) t
                                    WHERE rn <= 20
                                    GROUP BY question_id
                                ) q;
                                ''',
                                (child_id_transparent,)
                        )
                        res = cur.fetchone()[0]
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return res


@subapi.post('/division-remainder/answer')
async def store_answer_division_remainder(child_id_obfuscated: str, question_id: int, correct: bool):
        '''Store an answer (division remainder)'''
        print(f"Storing answer: child_id_obfuscated={child_id_obfuscated}, question_id={question_id}, correct={correct}")
        child_id_transparent = deobfuscate_id(child_id_obfuscated)
        print(f"Deobfuscated child_id: {child_id_transparent}")
        try:
                with db_cursor() as cur:
                        cur.execute(
                                '''
                                INSERT INTO answers_division_remainder (child_id_transparent, question_id, correct)
                                VALUES (%s, %s, %s)
                                ''',
                                (child_id_transparent, question_id, correct)
                        )
        except Exception as e:
                print(cur.query)
                print(cur.statusmessage)
                raise HTTPException(status_code=500, detail=str(e))
        return {"status": "success"}