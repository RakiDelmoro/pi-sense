FROM oven/bun:debian

RUN apt-get update && apt-get install -y git curl && \
    rm -rf /var/lib/apt/lists/*

# Make bun (installed for 'bun' user) + root's global bin accessible
ENV PATH="/home/bun/.bun/bin:/root/.bun/bin:${PATH}"

# Install the utility globally
RUN bun add -g --ignore-scripts @earendil-works/pi-coding-agent