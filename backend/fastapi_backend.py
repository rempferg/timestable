from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from fastapi import FastAPI, HTTPException, Query
import psycopg2
import psycopg2.pool
from pydantic import BaseModel
import urllib.error
import urllib.request


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


@subapi.get('/words')
async def get_words():
    '''Get all spelling words ordered by frequency.'''
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT id, word, frequency_dewiki
                FROM words
                ORDER BY frequency_dewiki DESC NULLS LAST, word ASC
                '''
            )
            return [
                {'id': word_id, 'word': word, 'frequency': frequency}
                for word_id, word, frequency in cur.fetchall()
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class WordAnswer(BaseModel):
    word_id: int
    correct: bool


class WordAnswersPayload(BaseModel):
    child_id_obfuscated: str
    answers: list[WordAnswer]


@subapi.post('/words/answers')
async def store_word_answers(payload: WordAnswersPayload):
    '''Store spelling answers for a batch of words.'''
    child_id_transparent = deobfuscate_id(payload.child_id_obfuscated)
    # Assign strictly increasing timestamps: now() is stable within a transaction, so a
    # repeated word_id in the same submission would otherwise collide on the primary key.
    base_time = datetime.now(timezone.utc)
    try:
        with db_cursor() as cur:
            cur.executemany(
                '''
                INSERT INTO word_list_answers (child_id_transparent, word_id, correct, answered_at)
                VALUES (%s, %s, %s, %s)
                ''',
                [
                    (
                        child_id_transparent,
                        answer.word_id,
                        answer.correct,
                        base_time + timedelta(microseconds=index)
                    )
                    for index, answer in enumerate(payload.answers)
                ]
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success"}


@subapi.get('/words/progress/{child_id_obfuscated}')
async def get_words_progress(child_id_obfuscated: str):
    '''Get spelling progress for a child.'''
    child_id_transparent = deobfuscate_id(child_id_obfuscated)
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT COALESCE(JSON_AGG(q ORDER BY q.word_id), '[]'::json)
                FROM (
                  SELECT
                    word_id,
                    JSON_AGG(
                      JSON_BUILD_OBJECT(
                        'correct', correct,
                        'answered_at', to_char(answered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                      )
                      ORDER BY answered_at DESC
                    ) AS answers
                  FROM (
                    SELECT
                      word_id, correct, answered_at,
                      ROW_NUMBER() OVER (
                        PARTITION BY child_id_transparent, word_id
                        ORDER BY answered_at DESC
                      ) AS rn
                    FROM word_list_answers
                    WHERE child_id_transparent = %s
                  ) t
                  WHERE rn <= 20
                  GROUP BY word_id
                ) q;
                ''',
                (child_id_transparent,)
            )
            res = cur.fetchone()[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res


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


# Mirrors the answer history length the frontend uses for its word grouping.
WORD_PROGRESS_ANSWER_LIMIT = 20

# AI sentence generation through the OpenCode Zen subscription.

OPENCODE_ZEN_RESPONSES_URL = 'https://opencode.ai/zen/go/v1/responses'
OPENCODE_ZEN_CHAT_COMPLETIONS_URL = 'https://opencode.ai/zen/go/v1/chat/completions'
OPENCODE_ZEN_API_KEY_ENV = 'OPENCODE_ZEN_API_KEY'

# Switch models by commenting out one config dict and enabling the other.
# The endpoints use different API styles (Responses API vs Chat Completions API),
# handled in _request_zen_sentence.
OPENCODE_ZEN_MODEL_CONFIG = {
    'model': 'deepseek-v4-flash',
    'url': OPENCODE_ZEN_CHAT_COMPLETIONS_URL,
    'reasoning_effort': 'low',
}
# OPENCODE_ZEN_MODEL_CONFIG = {
#     'model': 'muse-spark-1.2-contributor',
#     'url': OPENCODE_ZEN_RESPONSES_URL,
#     'reasoning_effort': 'minimal',
# }

# Number of highest-priority words handed to the model as candidates.
SENTENCE_PROMPT_WORD_LIMIT = 50

# Prompt order differs from the frontend display order (1, 2, 3, 4):
# recently wrong first, then never tried, then shaky, then mastered.
AI_PROMPT_GROUP_PRIORITY = {1: 0, 3: 1, 2: 2, 4: 3}

SENTENCE_PROMPT_LEADING = (
    'Create a sentence exclusively with words from this word list. '
    'Earlier words in the list have higher priority. '
    'The order of the words does not matter - grammatical correctness does. '
    'Keep every word in its natural part of speech: do not use nouns (capitalized) '
    'as other word types and vice versa. '
    'Ideally the sentence is 7-10 words long, if possible. '
    "Don't overthink it. Give me the first sentence you come up with.\n\n"
    'Word list: '
)
SENTENCE_PROMPT_TRAILING = '\n\nAnswer with the sentence only. No quotes, no explanation.'

# Upper bound for the number of wrongly answered words handled per request.
MISTAKES_WORD_LIMIT_MAX = 50
MISTAKES_WORD_LIMIT_DEFAULT = 25

MISTAKE_MISSPELLING_COUNT = 3

# Generating practice aids for a whole batch of words can take well over 30 seconds.
MISTAKES_REQUEST_TIMEOUT = 120

MISTAKES_PROMPT_LEADING = (
    'For each word in this list of German spelling words, do two things. '
    'First, give exactly 3 common misspellings that a German elementary school child '
    '(age 6-10) might realistically write instead of the correct spelling. '
    'Common mistakes at this age are: mixing up capitalization, '
    'mixing up i and ie, mixing up e and ä, '
    'inserting or omitting the silent h, '
    'and inserting or omitting double consonants. '
    'Draw all misspellings from these mistake patterns where applicable; '
    'at least one misspelling should only differ in capitalization. '
    'Second, write one short and simple German sentence that contains the word spelled correctly. '
    'Never place the word in the first position of the sentence. '
    'The sentence should use easy vocabulary a 6-10 year old knows '
    'and be about 5-8 words long.\n\n'
    'Word list: '
)
MISTAKES_PROMPT_TRAILING = (
    '\n\nKeep every word exactly as given. '
    'Answer with a JSON array only. No markdown fences, no explanation: '
    '[{"word": "<original word>", "misspellings": ["<misspelling>", "<misspelling>", "<misspelling>"], '
    '"sentence": "<sentence>"}]'
)


def _word_progress_group(answers: list[dict], now: datetime) -> int:
    '''Group a word like the frontend word list does (1 needs practice ... 4 mastered).

    `answers` must be ordered newest first with at most WORD_PROGRESS_ANSWER_LIMIT entries,
    using naive UTC timestamps just like the database returns them.
    '''
    if not answers:
        return 3

    if not answers[0]['correct']:
        return 1

    last_incorrect_index = next(
        (index for index, answer in enumerate(answers) if not answer['correct']),
        None
    )

    if last_incorrect_index is None:
        return 4 if len(answers) >= 2 else 2

    streak_answers_count = last_incorrect_index
    streak_start = answers[last_incorrect_index - 1]['answered_at']
    streak_duration_days = (now - streak_start).total_seconds() / timedelta(days=1).total_seconds()

    if streak_answers_count >= 3 and streak_duration_days >= 7:
        return 4
    return 2


@subapi.get('/words/sentence/{child_id_obfuscated}')
async def generate_word_sentence(child_id_obfuscated: str):
    '''Generate a sentence for a child from their most urgent spelling words.'''
    child_id_transparent = deobfuscate_id(child_id_obfuscated)
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT id, word, frequency_dewiki
                FROM words
                ORDER BY frequency_dewiki DESC NULLS LAST, word ASC
                '''
            )
            words = [
                {'id': word_id, 'word': word, 'frequency': frequency}
                for word_id, word, frequency in cur.fetchall()
            ]
            cur.execute(
                f'''
                SELECT word_id, correct, answered_at
                FROM (
                  SELECT
                    word_id, correct, answered_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY word_id
                      ORDER BY answered_at DESC
                    ) AS rn
                  FROM word_list_answers
                  WHERE child_id_transparent = %s
                ) t
                WHERE rn <= {WORD_PROGRESS_ANSWER_LIMIT}
                ORDER BY word_id, rn
                ''',
                (child_id_transparent,)
            )
            answers_by_word_id: dict[int, list[dict]] = {}
            for word_id, correct, answered_at in cur.fetchall():
                answers_by_word_id.setdefault(word_id, []).append(
                    {'correct': correct, 'answered_at': answered_at}
                )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Database timestamps are naive UTC values, so compare against naive UTC now.
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    def prompt_priority(word: dict) -> int:
        group = _word_progress_group(answers_by_word_id.get(word['id'], []), now)
        return AI_PROMPT_GROUP_PRIORITY[group]

    ordered_words = sorted(words, key=prompt_priority)
    candidate_words = ordered_words[:SENTENCE_PROMPT_WORD_LIMIT]
    if not candidate_words:
        return {'sentence': '', 'words': []}

    prompt = SENTENCE_PROMPT_LEADING + ', '.join(
        entry['word'] for entry in candidate_words
    ) + SENTENCE_PROMPT_TRAILING

    sentence = _request_zen_sentence(prompt)

    # Map the sentence back to our word entries so the frontend can show them as chips.
    word_by_normalized = {entry['word'].lower(): entry for entry in words}
    strip_characters = '.,!?;:"\'„“”‚‘’()[]{}–—-'
    matched_words = []
    seen_word_ids = set()
    for token in sentence.split():
        normalized = token.strip(strip_characters).lower()
        if not normalized or normalized in seen_word_ids:
            continue
        entry = word_by_normalized.get(normalized)
        if entry is not None:
            seen_word_ids.add(normalized)
            matched_words.append(entry)

    return {'sentence': sentence, 'words': matched_words}


@subapi.get('/words/mistakes/{child_id_obfuscated}')
async def get_word_mistakes(
    child_id_obfuscated: str,
    limit: int = Query(
        default=MISTAKES_WORD_LIMIT_DEFAULT,
        ge=1,
        le=MISTAKES_WORD_LIMIT_MAX
    )
):
    '''Get words the child last answered incorrectly, with AI-generated practice aids.'''
    child_id_transparent = deobfuscate_id(child_id_obfuscated)
    try:
        with db_cursor() as cur:
            cur.execute(
                '''
                SELECT words.word
                FROM (
                  SELECT DISTINCT ON (word_id) word_id, correct, answered_at
                  FROM word_list_answers
                  WHERE child_id_transparent = %s
                  ORDER BY word_id, answered_at DESC
                ) latest_answers
                JOIN words ON words.id = latest_answers.word_id
                WHERE latest_answers.correct = false
                ORDER BY random()
                LIMIT %s
                ''',
                (child_id_transparent, limit)
            )
            wrong_words = [row[0] for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not wrong_words:
        return []

    prompt = MISTAKES_PROMPT_LEADING + ', '.join(wrong_words) + MISTAKES_PROMPT_TRAILING
    answer_text = _request_zen_text(
        prompt,
        context='Misspelling generation',
        timeout=MISTAKES_REQUEST_TIMEOUT
    )
    generated_entries = _parse_mistakes_json(answer_text)

    generated_by_word: dict[str, dict] = {}
    for entry in generated_entries:
        word = entry.get('word')
        if isinstance(word, str) and word.strip():
            generated_by_word[word.strip().lower()] = entry

    return [
        {
            'word': word,
            'misspellings': _clean_misspellings(
                generated_by_word.get(word.lower(), {}).get('misspellings')
            ),
            'sentence': _clean_sentence(
                generated_by_word.get(word.lower(), {}).get('sentence')
            )
        }
        for word in wrong_words
    ]


def _parse_mistakes_json(text: str) -> list[dict]:
    '''Parse the JSON array of mistake entries out of a model answer.'''
    start = text.find('[')
    end = text.rfind(']')
    if start == -1 or end == -1 or end <= start:
        return []
    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [entry for entry in parsed if isinstance(entry, dict)]


def _clean_misspellings(raw_misspellings: object) -> list[str]:
    '''Return up to MISTAKE_MISSPELLING_COUNT non-empty misspelling strings.'''
    if not isinstance(raw_misspellings, list):
        return []
    cleaned = [
        misspelling.strip()
        for misspelling in raw_misspellings
        if isinstance(misspelling, str) and misspelling.strip()
    ]
    return cleaned[:MISTAKE_MISSPELLING_COUNT]


def _clean_sentence(raw_sentence: object) -> str:
    '''Return the sentence as a stripped string, or an empty string if invalid.'''
    if isinstance(raw_sentence, str):
        return raw_sentence.strip()
    return ''


def _request_zen_sentence(prompt: str) -> str:
    '''Ask the OpenCode Zen model to write a sentence and return its answer text.'''
    return _request_zen_text(prompt, context='Sentence generation')


def _request_zen_text(
    prompt: str,
    *,
    context: str,
    timeout: int = 30,
    retries: int = 1
) -> str:
    '''Send a prompt to the OpenCode Zen model and return its answer text.

    Network-level failures (e.g. read timeouts) are retried `retries` times,
    while API-level HTTP errors fail immediately.
    '''
    api_key = os.getenv(OPENCODE_ZEN_API_KEY_ENV)
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=f'Missing required environment variable: {OPENCODE_ZEN_API_KEY_ENV}'
        )

    if OPENCODE_ZEN_MODEL_CONFIG['url'] == OPENCODE_ZEN_CHAT_COMPLETIONS_URL:
        # OpenAI Chat Completions API style.
        payload = {
            'model': OPENCODE_ZEN_MODEL_CONFIG['model'],
            'reasoning_effort': OPENCODE_ZEN_MODEL_CONFIG['reasoning_effort'],
            'messages': [{'role': 'user', 'content': prompt}]
        }
    else:
        # OpenAI Responses API style.
        payload = {
            'model': OPENCODE_ZEN_MODEL_CONFIG['model'],
            'reasoning': {'effort': OPENCODE_ZEN_MODEL_CONFIG['reasoning_effort']},
            'input': prompt,
        }
    request = urllib.request.Request(
        OPENCODE_ZEN_MODEL_CONFIG['url'],
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
            # The default "Python-urllib" user agent is rejected by Cloudflare (error 1010).
            'User-Agent': 'timestable-backend/0.1'
        },
        method='POST'
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='replace')
            raise HTTPException(
                status_code=502,
                detail=f'{context} failed: {e.code} {detail}'
            ) from e
        except HTTPException:
            raise
        except Exception as e:
            if attempt >= retries:
                raise HTTPException(status_code=502, detail=f'{context} failed: {e}') from e

    text = _extract_answer_text(body)
    if not text:
        raise HTTPException(status_code=502, detail=f'{context} returned no text')
    return text


def _extract_answer_text(body: dict) -> str:
    '''Extract answer text from Chat Completions or Responses API payloads.'''
    choices = body.get('choices')
    if isinstance(choices, list) and choices:
        message = choices[0].get('message', {})
        content = message.get('content')
        if isinstance(content, str) and content.strip():
            return content.strip()

    # OpenAI Responses API format: text lives in output[] message items' output_text parts.
    text_parts = []
    for item in body.get('output') or []:
        if isinstance(item, dict) and item.get('type') == 'message':
            for part in item.get('content') or []:
                if isinstance(part, dict) and part.get('type') == 'output_text':
                    text_parts.append(part.get('text', ''))

    if not text_parts and isinstance(body.get('output_text'), str):
        text_parts.append(body['output_text'])

    return ''.join(text_parts).strip()


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