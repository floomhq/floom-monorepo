FROM python:3.12-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

RUN pip install --no-cache-dir crawl4ai fastapi uvicorn pydantic \
  && python -m playwright install --with-deps chromium

COPY engine_server.py .
RUN mkdir -p /data \
  && chown -R appuser:appuser /app /data /home/appuser

ENV PORT=8000
ENV DATA_DIR=/data
EXPOSE 8000
USER appuser

CMD ["sh", "-c", "uvicorn engine_server:app --host 0.0.0.0 --port ${PORT:-8000}"]
