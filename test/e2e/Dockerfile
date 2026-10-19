# Isolated environment for the local end-to-end tests (bun run test:e2e).
# The agent versions are the compatibility claim under test; they come from
# docs/hosts.jsonc and are passed as build args by test/e2e/run.ts, so a manual
# docker build without them fails instead of silently using stale pins.
# No secrets are baked in; DEEPSEEK_API_KEY is passed at `docker run` time.

ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS agents
ARG OPENCODE_VERSION
ARG PI_VERSION
# An empty version would silently resolve to npm "latest", drifting off the
# pins — fail the build instead.
RUN test -n "$OPENCODE_VERSION" && test -n "$PI_VERSION"
RUN npm install --global --prefix /opt/agents \
      @opencode/cli@${OPENCODE_VERSION} \
      @earendil-works/pi-coding-agent@${PI_VERSION}

FROM ${NODE_IMAGE}
COPY --from=agents /opt/agents /opt/agents
ENV PATH=/opt/agents/bin:$PATH
WORKDIR /work
