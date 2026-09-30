# EdgeVault Cloud Sync API
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CONFLICTS_DB_PATH=/data/cloud_conflicts.db

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY sync_api ./sync_api
COPY scripts ./scripts

RUN useradd --create-home --uid 10001 edgevault && mkdir -p /data && chown edgevault /data
USER edgevault

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status == 200 else 1)"

# One worker: the conflicts store is SQLite and server_ts is issued in-process.
CMD ["uvicorn", "sync_api.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
