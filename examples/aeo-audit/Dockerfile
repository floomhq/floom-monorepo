FROM python:3.12-slim

ARG OPENANALYTICS_REPO=https://github.com/federicodeponte/openanalytics.git
ARG OPENANALYTICS_REF=58435d91542c827198d7d48d6d32b46bac9fdf4e

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl git \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

RUN git clone --depth 1 "$OPENANALYTICS_REPO" /tmp/openanalytics \
  && cd /tmp/openanalytics \
  && git fetch --depth 1 origin "$OPENANALYTICS_REF" \
  && git checkout "$OPENANALYTICS_REF" \
  && cp -R . /app \
  && rm -rf /tmp/openanalytics /app/.git

RUN pip install --no-cache-dir -r requirements.txt \
  && playwright install --with-deps chromium \
  && chown -R appuser:appuser /app

ENV PORT=8000
EXPOSE 8000
USER appuser

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
