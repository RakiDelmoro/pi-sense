FROM oven/bun:debian

# Install Node.js 22.x instead of the outdated Debian package
RUN apt-get update && apt-get install -y git mosquitto mosquitto-clients curl && rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs

RUN curl -sL https://dl.influxdata.com/influxdb/releases/influxdb2-2.7.11_linux_amd64.tar.gz | tar -xzf - -C /tmp && \
    cp /tmp/influxdb2-2.7.11/usr/bin/influxd /usr/local/bin/influxd && \
    rm -rf /tmp/influxdb2-2.7.11

RUN curl -sL https://dl.influxdata.com/influxdb/releases/influxdb2-client-2.7.5-linux-amd64.tar.gz | tar -xzf - -C /tmp && \
    cp /tmp/influx /usr/local/bin/influx && \
    rm -rf /tmp/influx