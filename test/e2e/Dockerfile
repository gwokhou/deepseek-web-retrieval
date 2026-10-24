# Isolated environment for the local end-to-end tests (bun run test:e2e).
# The agent versions are the compatibility claim under test; they come from
# docs/hosts.jsonc and are passed as build args by test/e2e/run.ts, so a manual
# docker build without them fails instead of silently using stale pins.
# No secrets are baked in; DEEPSEEK_API_KEY is passed at `docker run` time.

# Pinned base image so e2e runs are reproducible; bump it deliberately.
ARG NODE_IMAGE=node:22.23.3-slim

FROM ${NODE_IMAGE} AS agents
ARG OPENCODE_VERSION
ARG PI_VERSION
ARG CODEX_VERSION
ARG CLAUDE_CODE_VERSION
# An empty version would silently resolve to npm "latest", drifting off the
# pins — fail the build instead.
RUN test -n "$OPENCODE_VERSION" && test -n "$PI_VERSION" && test -n "$CODEX_VERSION" && test -n "$CLAUDE_CODE_VERSION"
# npm 10 intermittently skips platform-specific optional dependencies on
# --prefix global installs (seen with @openai/codex-linux-x64); npm 12 resolves
# them reliably but blocks non-allowlisted install scripts by default, so
# @opencode/cli's and @anthropic-ai/claude-code's required postinstalls are
# explicitly allowed — the packages are version-pinned above, making the
# allowlist auditable. The checks and retry below stay as the guarantee either way.
RUN npm install --global npm@12.2.0 && npm --version
RUN (npm install --global --prefix /opt/agents --allow-scripts=@opencode/cli,@anthropic-ai/claude-code \
        @opencode/cli@${OPENCODE_VERSION} \
        @earendil-works/pi-coding-agent@${PI_VERSION} \
        @openai/codex@${CODEX_VERSION} \
        @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      && /opt/agents/bin/opencode --version \
      && /opt/agents/bin/pi --version \
      && /opt/agents/bin/codex --version \
      && /opt/agents/bin/claude --version) \
    || (npm install --global --prefix /opt/agents --force --allow-scripts=@opencode/cli,@anthropic-ai/claude-code \
        @opencode/cli@${OPENCODE_VERSION} \
        @earendil-works/pi-coding-agent@${PI_VERSION} \
        @openai/codex@${CODEX_VERSION} \
        @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      && /opt/agents/bin/opencode --version \
      && /opt/agents/bin/pi --version \
      && /opt/agents/bin/codex --version \
      && /opt/agents/bin/claude --version)

FROM ${NODE_IMAGE}
COPY --from=agents /opt/agents /opt/agents
ENV PATH=/opt/agents/bin:$PATH
# Codex is a static musl binary whose rustls reads the system CA store; the slim
# base ships none (Node bundles its own, which is why the node-based agents
# worked). Without it every Codex HTTPS request fails as "error sending request".
RUN apt-get update \
      && apt-get install -y --no-install-recommends ca-certificates \
      && rm -rf /var/lib/apt/lists/*
WORKDIR /work
