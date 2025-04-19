# Router MQTT Publisher

## Description
This project is a script that connects to an HG6145F router, retrieves basic device information, and publishes the data to an MQTT broker. It is designed to integrate with Home Assistant, enabling automatic sensor discovery.

## Requirements
- Node.js (version 14 or higher)
- An accessible MQTT broker
- An HG6145F router with enabled access

## Installation
1. Clone this repository:
   ```bash
   git clone <REPOSITORY_URL>
   cd hg6145f_mqtt_publishier
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root with the following environment variables:
   ```env
   ROUTER_IP=<ROUTER_IP>
   ROUTER_USERNAME=<ROUTER_USERNAME>
   ROUTER_PASSWORD=<ROUTER_PASSWORD>
   MQTT_HOST=<MQTT_BROKER_HOST>
   MQTT_PORT=<MQTT_BROKER_PORT>
   MQTT_USERNAME=<MQTT_USERNAME>
   MQTT_PASSWORD=<MQTT_PASSWORD>
   MQTT_TOPIC_CONFIG_PREFIX=homeassistant/sensor/routerBaseInfo
   MQTT_CLIENT_ID=router-mqtt-publisher
   ```

## Usage
Run the script with the following command:
```bash
node router_mqtt_publisher.js
```
The script will connect to the router, retrieve basic information, and publish the data to the MQTT broker. Once completed, the script will automatically terminate.

## Published Sensors
The following sensors are published to Home Assistant:
- `ponBytesSent`: Bytes sent by the router.
- `ponBytesReceived`: Bytes received by the router.

### Home Assistant Configuration
The sensors are automatically configured via MQTT discovery. Ensure your Home Assistant instance is set up to detect MQTT devices.

## Contributions
Contributions are welcome. Please open an issue or submit a pull request with your improvements.

## License
This project is licensed under the MIT License.