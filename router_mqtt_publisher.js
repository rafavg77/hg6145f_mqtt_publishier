import puppeteer from 'puppeteer';
import mqtt from 'mqtt';
import 'dotenv/config';
import pino from 'pino';
import pinoLoki from 'pino-loki';

// Loki Configuration from environment variable
const lokiUrl = process.env.LOKI_URL;

// Initialize Pino logger with Loki transport
const streams = [
    { stream: process.stdout } // Keep logging to console
];

if (lokiUrl) {
    // Log the Loki URL being used for configuration for easier debugging
    console.log(`[INFO] Attempting to configure pino-loki with URL: ${lokiUrl}`);
    streams.push({
        stream: pinoLoki({
            batching: true,
            interval: 5, // Batch logs every 5 seconds
            host: lokiUrl, // This is the crucial part that uses the LOKI_URL
            labels: { application: 'router-mqtt-publisher' },
            timeout: 10000, // Increased timeout to 10 seconds
            onWriteError: (err) => {
                // Log details when failing to send logs to Loki
                // The 'lokiUrl' in this scope is the one pinoLoki was configured with.
                console.error(`[LOKI_WRITE_ERROR] Failed to send log batch to Loki. Configured URL: ${lokiUrl}. Error: ${err.message}`, err);
            }
        })
    });
} else {
    console.log('[INFO] LOKI_URL not defined. Skipping pino-loki configuration.');
}

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    // base: null, // Uncomment to remove pid, hostname from logs
    timestamp: pino.stdTimeFunctions.epochTime, // Changed from isoTime to epochTime
}, pino.multistream(streams));

// Replace previous custom log function with logger
const log = (message, type = 'INFO', data = {}) => {
    const upperType = type.toUpperCase();
    switch (upperType) {
        case 'ERROR':
            logger.error(data, message);
            break;
        case 'WARN':
            logger.warn(data, message);
            break;
        case 'DEBUG':
            logger.debug(data, message);
            break;
        case 'INFO':
        default:
            logger.info(data, message);
            break;
    }
};

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

// Create a single MQTT client instance
let client = null;
let isConnected = false;
let pendingMessages = 0;

// Function to initialize MQTT client only once
const initializeMqttClient = () => {
    if (client === null) {
        // Connect to MQTT broker with authentication
        client = mqtt.connect({
            host: mqttHost,
            port: mqttPort,
            username: mqttUsername,
            password: mqttPassword,
            clientId: mqttClientId,
            reconnectPeriod: 5000,  // Wait 5 seconds before reconnecting
            clean: true
        });

        client.on('connect', () => {
            if (!isConnected) {
                isConnected = true;
                log('Connected to MQTT broker', 'INFO');
            }
        });

        client.on('reconnect', () => {
            log('Attempting to reconnect to MQTT broker', 'INFO');
        });

        client.on('error', (err) => {
            log(`MQTT connection error: ${err.message}`, 'ERROR', { error: err });
        });

        client.on('offline', () => {
            isConnected = false;
            log('MQTT client is offline', 'WARN');
        });

        client.on('close', () => {
            isConnected = false;
            log('MQTT connection closed', 'INFO');
        });
    }
    
    return client;
};

// Add message tracking
const trackMessage = () => {
    pendingMessages++;
};

const untrackMessage = () => {
    pendingMessages--;
    if (pendingMessages === 0) {
        log('All messages published successfully', 'INFO');
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
    return new Promise((resolve) => { // Changed reject to resolve in signature for simplicity, always resolves.
        const mqttClient = initializeMqttClient();
        
        // Define the actual publishing logic as a callable function
        function doPublishing() {
            const filteredData = {
                ponBytesSent: bytesToGigabytes(data.ponBytesSent),
                ponBytesReceived: bytesToGigabytes(data.ponBytesReceived),
            };

            if (Object.keys(filteredData).length === 0) {
                log('No data to publish after filtering.', 'INFO');
                resolve(); 
                return;
            }
            
            let totalPublishes = Object.keys(filteredData).length * 2; 
            let completedPublishes = 0;
            let errorsInPublishing = false;

            if (totalPublishes === 0) { // Should be caught by previous check, but as a safeguard
                log('No publish operations to perform.', 'INFO');
                resolve();
                return;
            }

            Object.entries(filteredData).forEach(([key, value]) => {
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
                
                const stateData = { [key]: value };

                const publishCallback = (type, topic, err) => {
                    completedPublishes++;
                    if (err) {
                        log(`Failed to publish ${type} for ${key} to ${topic}: ${err.message}`, 'ERROR', { error: err, topic, key, publishType: type });
                        errorsInPublishing = true;
                    } else {
                        log(`${type} published for ${key} to ${topic}`, 'DEBUG', { topic, key, publishType: type }); // Changed to DEBUG for less verbose successful publishes
                    }

                    if (completedPublishes === totalPublishes) {
                        if (errorsInPublishing) {
                            log('Some MQTT messages failed to publish during this cycle.', 'WARN');
                        } else {
                            log('All MQTT messages for this cycle published successfully.', 'INFO');
                        }
                        resolve(); 
                    }
                };

                log(`Publishing config to ${sensorConfigTopic}: ${JSON.stringify(sensorConfig)}`, 'DEBUG');
                mqttClient.publish(sensorConfigTopic, JSON.stringify(sensorConfig), { retain: true, qos: 1 }, (err) => publishCallback('config', sensorConfigTopic, err));
                
                log(`Publishing state to ${sensorStateTopic}: ${JSON.stringify(stateData)}`, 'DEBUG');
                mqttClient.publish(sensorStateTopic, JSON.stringify(stateData), { retain: true, qos: 1 }, (err) => publishCallback('state', sensorStateTopic, err));
            });
        }

        if (!isConnected) {
            log('MQTT not connected. Waiting up to 10s for connection before attempting publish...', 'WARN');
            const waitTimeoutId = setTimeout(() => {
                clearTimeout(waitTimeoutId); // Clear timeout as it has executed
                if (!isConnected) {
                    log('MQTT connection still not available after 10s. Skipping publish for this cycle.', 'ERROR');
                    resolve(); // Resolve to prevent app crash
                } else {
                    log('MQTT connected after waiting. Proceeding with publish.', 'INFO');
                    doPublishing();
                }
            }, 10000); 
        } else {
            doPublishing();
        }
    });
};

// Update the function to include sensor publishing
const performRouterOperationsAndPublish = async () => {
    log('Initializing browser...', 'INFO');
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/usr/bin/chromium-browser'  // Use system Chromium
    });
    const page = await browser.newPage();
    await page.goto(`http://${routerIp}`);
    await page.waitForNavigation();

    page.on('dialog', async dialog => await dialog.accept());

    log('Logging into router...', 'INFO');
    await page.type('#user_name', routerUsername);
    await page.type('#loginpp', routerPassword);
    await page.click('#login_btn');
    await page.waitForNavigation();

    log('Fetching router information...', 'INFO');
    const baseInfoUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_base_info&_=0.04439007026162467`;
    const jsonResponse = await fetchJson(page, baseInfoUrl);
    log('Router information received:', 'DEBUG');
    log(JSON.stringify(jsonResponse), 'DEBUG');

    log('Fetching session ID...', 'INFO');
    const sessionIdUrl = `http://${routerIp}/cgi-bin/ajax?ajaxmethod=get_refresh_sessionid&_=0.9346017593427624`;
    const sessionJson = await fetchJson(page, sessionIdUrl);
    const sessionId = sessionJson.sessionid;

    log('Performing logout...', 'INFO');
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
    log('Browser closed', 'INFO');

    // Publish base info to MQTT as sensors
    return jsonResponse;
};

// Modify the main execution to run periodically
const runPeriodically = async () => {
    try {
        // Initialize MQTT client once at startup
        initializeMqttClient();
        
        log(`Starting execution with ${executionInterval} seconds interval`, 'INFO');
        while (true) {
            log('Starting new execution cycle...', 'INFO');
            const data = await performRouterOperationsAndPublish();
            await publishSensorsToMQTT(data);
            log('Execution completed successfully, waiting for next cycle...', 'INFO');
            await delay(executionInterval * 1000); // Convert seconds to milliseconds
        }
    } catch (err) {
        log(`Error during execution: ${err.message}`, 'ERROR', { error: err, stack: err.stack });
        // Graceful shutdown on critical error in main loop
        await gracefulShutdown('CRITICAL_ERROR'); 
        process.exit(1);
    }
};

// Start periodic execution
runPeriodically();

// Graceful shutdown
async function gracefulShutdown(signal) { // Made async to await client.end
    log(`Received ${signal}. Shutting down gracefully...`, 'INFO', { signal });
    if (client) {
        const endPromise = new Promise(async (resolveGraceful) => { // made callback async
            if (client.connected || isConnected) { 
                log('Attempting to close MQTT connection...', 'INFO');
                try {
                    await client.endAsync(false); // Use endAsync for promise support if available, or handle callback
                    log('MQTT client disconnected gracefully.', 'INFO');
                } catch (e) {
                    log('Error during MQTT client graceful disconnect, forcing.', 'WARN', { error: e });
                    try {
                        await client.endAsync(true); // Force close
                        log('MQTT client forced to disconnect.', 'INFO');
                    } catch (e2) {
                        log('Error forcing MQTT client disconnect.', 'ERROR', { error: e2 });
                    }
                }
                resolveGraceful();
            } else {
                log('MQTT client not connected or already closing.', 'INFO');
                resolveGraceful();
            }
        });

        await endPromise; // Wait for MQTT client to close
        log('Exiting process.', 'INFO');
        process.exit(0);

    } else {
        log('No MQTT client instance to close. Exiting.', 'INFO');
        process.exit(0);
    }

    // Fallback timeout for the entire graceful shutdown process
    setTimeout(() => {
        log('Graceful shutdown overall timeout. Forcing exit.', 'ERROR');
        process.exit(1);
    }, 5000); 
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));