FROM oven/bun:debian

# Install Git, Curl, and Node.js
RUN apt-get update && apt-get install -y git curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Make bun (installed for 'bun' user) + root's global bin accessible
ENV PATH="/home/bun/.bun/bin:/root/.bun/bin:${PATH}"

# Install the utility globally
RUN bun add -g --ignore-scripts @earendil-works/pi-coding-agent