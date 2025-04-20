import puppeteer from 'puppeteer';
import mqtt from 'mqtt';
import 'dotenv/config';

// Add logging utility
const log = (message, type = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
};

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

// Add execution interval from env
const executionInterval = parseInt(process.env.EXECUTION_INTERVAL, 10) || 30;

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
    log('Connected to MQTT broker');
});

client.on('error', (err) => {
    log(`MQTT connection error: ${err}`, 'ERROR');
});

// Add message tracking
const trackMessage = () => {
    pendingMessages++;
};

const untrackMessage = () => {
    pendingMessages--;
    if (pendingMessages === 0) {
        log('All messages published successfully');
    }
};

const fetchJson = async (page, url) => {
    const response = await page.goto(url);
    return response.json();
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Add byte conversion utility
const bytesToGigabytes = (bytes) => {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2);
};

// Modify publish function to use correct Home Assistant discovery topics
const publishSensorsToMQTT = (data) => {
    return new Promise((resolve, reject) => {
        if (!isConnected) {
            log('Waiting for MQTT connection...');
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
                ponBytesSent: bytesToGigabytes(data.ponBytesSent),
                ponBytesReceived: bytesToGigabytes(data.ponBytesReceived),
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
                    unit_of_measurement: 'GB',
                    state_class: 'total',
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
                log(`Publishing to ${sensorConfigTopic}: ${JSON.stringify(sensorConfig)}`);
                client.publish(sensorConfigTopic, JSON.stringify(sensorConfig), { retain: true, qos: 1 }, (err) => {
                    if (err) {
                        log(`Failed to publish config for ${key}: ${err}`, 'ERROR');
                        reject(err);
                    } else {
                        log(`Config published for ${key} to ${sensorConfigTopic}`);
                        untrackMessage();
                    }
                });

                // Track and publish state with JSON format
                trackMessage();
                const stateData = { [key]: value };
                log(`Publishing to ${sensorStateTopic}: ${JSON.stringify(stateData)}`);
                client.publish(sensorStateTopic, JSON.stringify(stateData), { retain: true, qos: 1 }, (err) => {
                    if (err) {
                        log(`Failed to publish state for ${key}: ${err}`, 'ERROR');
                        reject(err);
                    } else {
                        log(`State published for ${key} to ${sensorStateTopic}`);
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
    log('Initializing browser...');
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/usr/bin/chromium-browser'  // Use system Chromium
    });
    const page = await browser.newPage();
    await page.goto(`http://${routerIp}`);
    await page.waitForNavigation();

    page.on('dialog', async dialog => await dialog.accept());

    log('Logging into router...');
    await page.type('#user_name', routerUsername);
    await page.type('#loginpp', routerPassword);
    await page.click('#login_btn');
    await page.waitForNavigation();

    log('Fetching router information...');
    const baseInfoUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_base_info&_=0.04439007026162467`;
    const jsonResponse = await fetchJson(page, baseInfoUrl);
    log('Router information received:', 'DEBUG');
    log(JSON.stringify(jsonResponse), 'DEBUG');

    log('Fetching session ID...');
    const sessionIdUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_refresh_sessionid&_=0.9346017593427624`;
    const sessionJson = await fetchJson(page, sessionIdUrl);
    const sessionId = sessionJson.sessionid;

    log('Performing logout...');
    const logoutResponse = await page.evaluate(async (sessionId) => {
        const response = await fetch('/cgi-bin/ajax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `sessionid=${sessionId}&username=common&ajaxmethod=do_logout&_=0.5212332680773836`,
        });
        return response.ok;
    }, sessionId);

    log(logoutResponse ? 'Logout successful' : 'Error during logout', logoutResponse ? 'INFO' : 'ERROR');
    await browser.close();
    log('Browser closed');

    // Publish base info to MQTT as sensors
    return jsonResponse;
};

// Modify the main execution to run periodically
const runPeriodically = async () => {
    try {
        log(`Starting execution with ${executionInterval} seconds interval`);
        while (true) {
            log('Starting new execution cycle...');
            const data = await performRouterOperationsAndPublish();
            await publishSensorsToMQTT(data);
            log('Execution completed successfully, waiting for next cycle...');
            await delay(executionInterval * 1000); // Convert seconds to milliseconds
        }
    } catch (err) {
        log(`Error during execution: ${err}`, 'ERROR');
        process.exit(1);
    }
};

// Start periodic execution
runPeriodically();