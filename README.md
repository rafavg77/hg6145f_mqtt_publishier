# Router MQTT Publisher

## Description
This project is a script that connects to an HG6145F router, retrieves network traffic information (bytes sent and received), and publishes this data to an MQTT broker. It is designed to integrate with Home Assistant, enabling automatic sensor discovery and monitoring of router traffic data.

## Requirements
- Node.js (version 14 or higher)
- An accessible MQTT broker
- An HG6145F router with enabled access
- Docker (optional, for containerized deployment)

## Features
- Automatic connection to HG6145F router
- Secure login and data retrieval
- MQTT integration with Home Assistant auto-discovery
- Automatic sensor creation for bytes sent and received
- Docker support for containerized deployment

## Installation

### Standard Installation
1. Clone this repository:
   ```bash
   git clone <REPOSITORY_URL>
   cd hg6145f_mqtt_publishier
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Docker Installation
1. Build the Docker image:
   ```bash
   docker build -t router-mqtt-publisher .
   ```

## Configuration
Create a `.env` file in the project root with the following environment variables:

```env
ROUTER_IP=<ROUTER_IP>
ROUTER_USERNAME=<ROUTER_USERNAME>
ROUTER_PASSWORD=<ROUTER_PASSWORD>
MQTT_HOST=<MQTT_BROKER_HOST>
MQTT_PORT=<MQTT_BROKER_PORT>
MQTT_USERNAME=<MQTT_USERNAME>
MQTT_PASSWORD=<MQTT_PASSWORD>
```

## Usage

### Running Locally
```bash
node router_mqtt_publisher.js
```

### Running with Docker
```bash
docker run --env-file .env --rm router-mqtt-publisher
```

## MQTT Topics Structure
The script publishes to the following MQTT topics:

### Configuration Topics
- `homeassistant/sensor/router_hg6145f/ponbytessent/config`
- `homeassistant/sensor/router_hg6145f/ponbytesreceived/config`

### State Topics
- `homeassistant/sensor/router_hg6145f/ponbytessent/state`
- `homeassistant/sensor/router_hg6145f/ponbytesreceived/state`

### Sensor Information
Each sensor includes:
- Device class: data_size
- Unit of measurement: bytes
- Icon: mdi:server-network
- Automatic device grouping in Home Assistant

## Home Assistant Integration
The sensors will automatically appear in Home Assistant under the "Router Device" group. No manual configuration is required in Home Assistant, as the script uses MQTT discovery.

## Docker Compose
You can also deploy using Docker Compose:

```yaml
version: '3.8'
services:
  router-mqtt-publisher:
    image: router-mqtt-publisher:latest
    environment:
      - ROUTER_IP=${ROUTER_IP}
      - ROUTER_USERNAME=${ROUTER_USERNAME}
      - ROUTER_PASSWORD=${ROUTER_PASSWORD}
      - MQTT_HOST=${MQTT_HOST}
      - MQTT_PORT=${MQTT_PORT}
      - MQTT_USERNAME=${MQTT_USERNAME}
      - MQTT_PASSWORD=${MQTT_PASSWORD}
    restart: unless-stopped
```

## Contributing
Contributions are welcome. Please open an issue or submit a pull request with your improvements.

## License
This project is licensed under the MIT License.