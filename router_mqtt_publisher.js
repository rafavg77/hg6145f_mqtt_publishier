import puppeteer from 'puppeteer';
import mqtt from 'mqtt';
import 'dotenv/config';

// Increase the maximum number of listeners to avoid memory leak warnings
//process.setMaxListeners(0); // Set to 0 for unlimited listeners

// MQTT Configuration
const mqttHost = process.env.MQTT_HOST;
const mqttPort = process.env.MQTT_PORT;
const mqttUsername = process.env.MQTT_USERNAME;
const mqttPassword = process.env.MQTT_PASSWORD;
const mqttTopicBaseInfo = process.env.MQTT_TOPIC_CONFIG_PREFIX;
const mqttTopicDataPrefix = process.env.MQTT_TOPIC_DATA_PREFIX;
const mqttClientId = 'publish-fiber-home-router';

// Define constants for router environment variables
const routerIp = process.env.ROUTER_IP;
const routerUsername = process.env.ROUTER_USERNAME;
const routerPassword = process.env.ROUTER_PASSWORD;

// Connect to MQTT broker with authentication
const client = mqtt.connect({
    host: mqttHost,
    port: mqttPort,
    username: mqttUsername,
    password: mqttPassword,
    clientId: mqttClientId,
});

// Add connection tracking
let isConnected = false;
let pendingMessages = 0;

client.on('connect', () => {
    isConnected = true;
    console.log('Connected to MQTT broker');
});

client.on('error', (err) => {
    console.error('MQTT connection error:', err);
});

// Add message tracking
const trackMessage = () => {
    pendingMessages++;
};

const untrackMessage = () => {
    pendingMessages--;
    if (pendingMessages === 0) {
        console.log('All messages published successfully');
        // Only exit after all messages are published
        client.end(true, () => {
            process.exit(0);
        });
    }
};

const fetchJson = async (page, url) => {
    const response = await page.goto(url);
    return response.json();
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Modify publish function to use correct Home Assistant discovery topics
const publishSensorsToMQTT = (data) => {
    return new Promise((resolve, reject) => {
        if (!isConnected) {
            console.log('Waiting for MQTT connection...');
            setTimeout(() => {
                if (!isConnected) {
                    reject(new Error('MQTT connection timeout'));
                    return;
                }
                publishData();
            }, 5000);
        } else {
            publishData();
        }

        function publishData() {
            const filteredData = {
                ponBytesSent: data.ponBytesSent,
                ponBytesReceived: data.ponBytesReceived,
            };

            Object.entries(filteredData).forEach(([key, value]) => {
                // Use consistent topic structure for Home Assistant discovery
                const deviceId = 'router_hg6145f';
                const entityId = key.toLowerCase();
                const sensorConfigTopic = `homeassistant/sensor/${deviceId}/${entityId}/config`;
                const sensorStateTopic = `homeassistant/sensor/${deviceId}/${entityId}/state`;

                const sensorConfig = {
                    name: `Router ${key}`,
                    state_topic: sensorStateTopic,
                    unique_id: `${deviceId}_${entityId}`,
                    device_class: 'data_size',
                    unit_of_measurement: 'bytes',
                    icon: 'mdi:server-network',
                    value_template: `{{ value_json.${key} }}`,
                    device: {
                        identifiers: [deviceId],
                        name: 'Router Device',
                        model: 'HG6145F',
                        manufacturer: 'FiberHome',
                    },
                };

                // Track and publish configuration
                trackMessage();
                console.log(`Publishing to ${sensorConfigTopic}:`, JSON.stringify(sensorConfig));
                client.publish(sensorConfigTopic, JSON.stringify(sensorConfig), { retain: true, qos: 1 }, (err) => {
                    if (err) {
                        console.error(`Failed to publish config for ${key}:`, err);
                        reject(err);
                    } else {
                        console.log(`Config published for ${key} to ${sensorConfigTopic}`);
                        untrackMessage();
                    }
                });

                // Track and publish state with JSON format
                trackMessage();
                const stateData = { [key]: value };
                console.log(`Publishing to ${sensorStateTopic}:`, JSON.stringify(stateData));
                client.publish(sensorStateTopic, JSON.stringify(stateData), { retain: true, qos: 1 }, (err) => {
                    if (err) {
                        console.error(`Failed to publish state for ${key}:`, err);
                        reject(err);
                    } else {
                        console.log(`State published for ${key} to ${sensorStateTopic}`);
                        untrackMessage();
                    }
                });
            });
            resolve();
        }
    });
};

// Update the function to include sensor publishing
const performRouterOperationsAndPublish = async () => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(`http://${routerIp}`);
    await page.waitForNavigation();

    page.on('dialog', async dialog => await dialog.accept());

    // Sign in
    await page.type('#user_name', routerUsername);
    await page.type('#loginpp', routerPassword);
    await page.click('#login_btn');
    await page.waitForNavigation();

    // Fetch base info
    const baseInfoUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_base_info&_=0.04439007026162467`;
    const jsonResponse = await fetchJson(page, baseInfoUrl);

    // Print the base info response to the console
    console.log('Base Info Response:', jsonResponse);

    // Fetch session ID
    const sessionIdUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_refresh_sessionid&_=0.9346017593427624`;
    const sessionJson = await fetchJson(page, sessionIdUrl);
    const sessionId = sessionJson.sessionid;

    // Perform logout
    const logoutResponse = await page.evaluate(async (sessionId) => {
        const response = await fetch('/cgi-bin/ajax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `sessionid=${sessionId}&username=common&ajaxmethod=do_logout&_=0.5212332680773836`,
        });
        return response.ok;
    }, sessionId);

    console.log(logoutResponse ? 'Logout realizado correctamente.' : 'Error al realizar el logout.');

    await browser.close();

    // Publish base info to MQTT as sensors
    return jsonResponse;
};

// Update main execution to handle MQTT properly
(async () => {
    try {
        const data = await performRouterOperationsAndPublish();
        await publishSensorsToMQTT(data);
        console.log('Execution completed successfully.');
    } catch (err) {
        console.error('Error during execution:', err);
        process.exit(1);
    }
})();