# Slack Poster — Floom Composio demo app
# Posts messages to Slack channels via Composio.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY main.py /app/main.py

USER 1000

# Floom runner: argv[1] = JSON config, last stdout line = __FLOOM_RESULT__<json>
ENTRYPOINT ["python", "/app/main.py"]
