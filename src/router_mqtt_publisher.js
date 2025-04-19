import puppeteer from 'puppeteer';
import mqtt from 'mqtt';
import 'dotenv/config';

// MQTT Configuration
const mqttHost = process.env.MQTT_HOST || 'mqtt://localhost';
const mqttPort = process.env.MQTT_PORT || 1883;
const mqttUsername = process.env.MQTT_USERNAME || '';
const mqttPassword = process.env.MQTT_PASSWORD || '';
const mqttTopicBaseInfo = process.env.MQTT_TOPIC_CONFIG_PREFIX || 'homeassistant/sensor/routerBaseInfo';
const mqttClientId = process.env.MQTT_CLIENT_ID || `publish-${Math.floor(Math.random() * 1000)}`;

// Connect to MQTT broker with authentication
const client = mqtt.connect({
    host: mqttHost,
    port: mqttPort,
    username: mqttUsername,
    password: mqttPassword,
    clientId: mqttClientId,
});

client.on('connect', () => {
    console.log('Connected to MQTT broker');
});

client.on('error', (err) => {
    console.error('MQTT connection error:', err);
});

const fetchJson = async (page, url) => {
    const response = await page.goto(url);
    return response.json();
};

// Function to publish sensors to MQTT for Home Assistant discovery
const publishSensorsToMQTT = (data) => {
    Object.entries(data).forEach(([key, value]) => {
        const sensorConfigTopic = `${process.env.MQTT_TOPIC_CONFIG_PREFIX}/${key}/config`;
        const sensorStateTopic = `${process.env.MQTT_TOPIC_DATA_PREFIX}/${key}/state`;

        // Publish sensor configuration for Home Assistant discovery
        client.publish(sensorConfigTopic, JSON.stringify({
            name: `Router ${key}`,
            state_topic: sensorStateTopic,
            unique_id: `router_${key}`,
            device: {
                identifiers: ['router_device'],
                name: 'Router Device',
                model: 'HG6145F',
                manufacturer: 'FiberHome',
            },
        }), { retain: true });

        // Publish sensor state
        client.publish(sensorStateTopic, String(value), { retain: true });
    });
    console.log('Sensors published to MQTT for Home Assistant discovery');
};

// Update the function to include sensor publishing
const performRouterOperationsAndPublish = async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(`http://${process.env.ROUTER_IP}`);
    await page.waitForNavigation();

    page.on('dialog', async dialog => await dialog.accept());

    // Sign in
    await page.type('#user_name', process.env.ROUTER_USERNAME);
    await page.type('#loginpp', process.env.ROUTER_PASSWORD);
    await page.click('#login_btn');
    await page.waitForNavigation();

    // Fetch base info
    const baseInfoUrl = `http://${process.env.ROUTER_IP}/cgi-bin/ajax?ajaxmethod=get_base_info&_=0.04439007026162467`;
    const jsonResponse = await fetchJson(page, baseInfoUrl);

    // Fetch session ID
    const sessionIdUrl = `http://${process.env.ROUTER_IP}/cgi-bin/ajax?ajaxmethod=get_refresh_sessionid&_=0.9346017593427624`;
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
    publishSensorsToMQTT(jsonResponse);

    return jsonResponse;
};

// Get the interval from environment variables (default to 60000ms or 1 minute)
const interval = parseInt(process.env.EXECUTION_INTERVAL, 10) || 60000;

// Function to repeatedly execute the router operations
const startPeriodicExecution = () => {
    console.log(`Starting periodic execution every ${interval}ms`);
    setInterval(async () => {
        try {
            await performRouterOperationsAndPublish();
        } catch (err) {
            console.error('Error during periodic execution:', err);
        }
    }, interval);
};

// Start the periodic execution
startPeriodicExecution();
