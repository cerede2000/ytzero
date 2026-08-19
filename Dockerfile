ARG YTZERO_VERSION=dev
ARG YTZERO_COMMIT=unknown

# ---- build UI ----
FROM oven/bun:1.3 AS ui-build
ARG YTZERO_VERSION
ARG YTZERO_COMMIT
ARG YTZERO_CHANGELOG_PREGENERATED=0
ENV YTZERO_VERSION=${YTZERO_VERSION} \
    YTZERO_COMMIT=${YTZERO_COMMIT}
WORKDIR /ui
COPY ui/package.json ui/bun.lock* ./
RUN bun install
COPY ui/ .
COPY shared/ /shared/
RUN if [ "${YTZERO_CHANGELOG_PREGENERATED}" = "1" ]; then bun run build:prepared; else bun run build; fi

# ---- runtime ----
# yt-dlp, fetched in a stage of its own.
#
# The URL below says "latest" and the instruction fetching it never changed, so
# the build cache answered it instead of GitHub: an image built today shipped
# whichever nightly was current the first time that layer ran, weeks earlier.
# Alone in a stage keyed by YTDLP_REVISION, it is fetched again whenever CI
# passes a new value, and only the binary crosses into the image — the install
# beside it, apt and Deno and the token provider, keeps its cache.
FROM alpine:3 AS ytdlp
# YouTube changes what it asks of a caller faster than yt-dlp cuts a stable
# release: the stable channel can be six weeks old while the challenge it has
# to answer changed last week, and the symptom is "Sign in to confirm you're
# not a bot" from yt-dlp on an address whose cookies still load a watch page
# perfectly. The nightly channel is the project's own answer to that, built
# from the same tree. Set YTDLP_CHANNEL=yt-dlp to pin the stable one back.
ARG YTDLP_CHANNEL=yt-dlp-nightly-builds
# Anything that changes per build. Its only job is to be different.
ARG YTDLP_REVISION=latest
RUN apk add --no-cache curl ca-certificates && \
    echo "fetching yt-dlp for ${YTDLP_REVISION}" && \
    curl -fsSL "https://github.com/yt-dlp/${YTDLP_CHANNEL}/releases/latest/download/yt-dlp" -o /yt-dlp && \
    chmod a+rx /yt-dlp

FROM oven/bun:1.3-slim
ARG DENO_VERSION=2.9.5
ARG POT_PROVIDER_VERSION=1.3.1
WORKDIR /app
RUN apt-get update && \
    apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends python3 ffmpeg curl ca-certificates unzip && \
    curl -fsSL https://deno.land/install.sh -o /tmp/install-deno.sh && \
    DENO_INSTALL=/usr/local sh /tmp/install-deno.sh "v${DENO_VERSION}" && \
    deno --version && \
    rm /tmp/install-deno.sh && \
    mkdir -p /etc/yt-dlp/plugins /opt/bgutil-ytdlp-pot-provider && \
    ( curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${POT_PROVIDER_VERSION}/bgutil-ytdlp-pot-provider.zip" \
        -o /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip && \
      curl -fsSL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${POT_PROVIDER_VERSION}.tar.gz" \
        | tar -xz -C /opt/bgutil-ytdlp-pot-provider --strip-components=1 && \
      python3 -c "import json, pathlib; p = pathlib.Path('/opt/bgutil-ytdlp-pot-provider/server/package.json'); d = json.loads(p.read_text()); d.pop('devDependencies', None); p.write_text(json.dumps(d))" && \
      cd /opt/bgutil-ytdlp-pot-provider/server && \
      DENO_NO_PROMPT=1 deno install --allow-scripts && \
      DENO_NO_PROMPT=1 deno run --allow-env --allow-net --allow-read --allow-write --allow-ffi --allow-sys \
        src/generate_once.ts --version ) \
    || ( echo "PO token provider unavailable at build time; continuing without it" && \
         rm -rf /opt/bgutil-ytdlp-pot-provider /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip ) && \
    cd /app && \
    apt-get purge -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*
# After the install, so python3 is there to run it, and after its own stage so
# a fresh binary does not cost the install its cache.
COPY --from=ytdlp /yt-dlp /usr/local/bin/yt-dlp
RUN yt-dlp --version
COPY app/package.json app/bun.lock* ./
RUN bun install --production
COPY app/src ./src
COPY app/scripts ./scripts
COPY shared/ /shared/
RUN chmod 0755 ./scripts/provision-ytdlp.sh
COPY --from=ui-build /ui/dist ./public

ARG YTZERO_VERSION
ARG YTZERO_COMMIT
ENV PORT=3001 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    IDLE_TIMEOUT_SECONDS=120 \
    DB_PATH=/data/db/ytzero.db \
    IMG_CACHE_DIR=/data/imgcache \
    IMG_CACHE_TTL_DAYS=7 \
    DOWNLOADS_DIR=/data/downloads \
    DENO_DIR=/data/deno-cache \
    POT_PROVIDER_HOME=/opt/bgutil-ytdlp-pot-provider/server \
    XDG_CACHE_HOME=/data/cache \
    DOWNLOAD_COOKIES_DIR=/data/download-cookies \
    YTDLP_BGUTIL_PLUGIN_DIR=/opt/ytzero/yt-dlp-plugins \
    YTDLP_BGUTIL_SERVER_HOME=/opt/ytzero/bgutil/server \
    RESTORE_SESSION_DIR=/data/restore-sessions \
    AVATAR_DIR=/data/avatars \
    LOG_PATH=/data/logs/ytzero.log \
    YTDLP_PATH=/data/bin/yt-dlp \
    YTDLP_PROVISION_MARKER=/data/bin/.yt-dlp-channel-reconciliation-pending \
    YTDLP_AUTO_UPDATE=1 \
    UI_DIST=./public \
    YTZERO_VERSION=${YTZERO_VERSION} \
    YTZERO_COMMIT=${YTZERO_COMMIT}

VOLUME /data
EXPOSE 3001

# curl is purged above to keep the image small, so probe with the Bun that is
# already here. Exits non-zero on a non-2xx status or a refused connection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e 'const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/api/health`); process.exit(r.ok ? 0 : 1)'

CMD ["./scripts/provision-ytdlp.sh", "bun", "src/index.ts"]
