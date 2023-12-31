const WebSocket = require('ws');
const CryptoJS = require('crypto-js');
const express = require('express');
require('dotenv').config();

const SIGNING_KEY = process.env.API_SECRET;
const API_KEY = process.env.API_KEY;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
const PORT = process.env.PORT || 3000;

const app = express();

const wss = new WebSocket.Server({ noServer: true });

const CHANNEL_NAMES = {
    ticker: 'ticker',
    level2: 'level2',
    matches: 'matches',
};

const PRODUCT_CHOICES = ['BTC-USD', 'LTC-USD', 'XRP-USD', 'ETH-USD'];

// let PRODUCTS = [];
let CHANNELS = [];
// let CONNECTIONS = [];
// let RATE_LIMIT = rateLimit(1, 250);

function preSocketErrorHandler(error) {
    console.log(error);
}

function postSocketErrorHandler(error) {
    console.log(error);
}

function sign(str, secret) {
    const hash = CryptoJS.HmacSHA256(str, secret);
    return hash.toString();
}

function timestampAndSign(message, channel, products = []) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const strToSign = `${timestamp}${channel}${products.join(',')}`;
    const sig = sign(strToSign, SIGNING_KEY);
    return { ...message, signature: sig, timestamp: timestamp };
}

function subscribeToProducts(products, channelName, ws) {
    const message = {
        type: 'subscribe',
        product_ids: products,
        channels: channelName,
        api_key: API_KEY,
    };
    const subscribeMsg = timestampAndSign(message, channelName, products);
    ws.send(JSON.stringify(subscribeMsg));
}

function closeConnections(CONNECTIONS) {
    CONNECTIONS.forEach((ws) => ws.close());
}

// set a rate limit on messages coming in that can be sent back to the client
function rateLimit(limit, interval) {
    let now = 0;
    const last = Symbol();
    const count = Symbol();
    setInterval(() => ++now, interval);

    return (ws) => {
        if (ws[last] != now) {
            ws[last] = now;
            ws[count] = 1;
        } else {
            return ++ws[count] > limit;
        }
    };
}

// not used but a function to unsubscribe if app was made a different way
function unsubscribeToProducts(channels, ws) {
    ws.send(
        JSON.stringify({
            type: 'unsubscribe',
            channels: channels,
            api_key: API_KEY,
        })
    );
}

// add channel if not already in channel list and remove other channels
function addChannelHandler(channelName) {
    if (!CHANNELS.includes(channelName)) {
        CHANNELS.push(channelName);
        CHANNELS = CHANNELS.filter((item) => item === channelName);
    }
}

// verify message is not already in products and
// subscribe to correct view
function verifyProductsSubscriptionHandler(
    message,
    socket,
    PRODUCTS,
    RATE_LIMIT
) {
    // convert message data to string
    let messageString = message.toString('utf8').trim().toUpperCase();

    // check if rate limit needs to be changed
    // if (messageString.includes('SYSTEM')) {
    //     // return if just system else slice number from string
    //     if (messageString === 'SYSTEM') {
    //         return;
    //     } else {
    //         // set rate limit
    //         let number = messageString.slice(6);
    //         RATE_LIMIT = rateLimit(1, number);
    //         return subscribeToProducts(PRODUCTS, [CHANNELS[0]], socket);
    //     }
    // }

    // check if request is for matches channel
    if (messageString.charAt(messageString.length - 1) === 'M') {
        messageString = messageString.slice(0, -1);
        // if the message is in the product choices and not in products
        // list then add it to the products list
        if (
            PRODUCT_CHOICES.includes(messageString) &&
            !PRODUCTS.includes(messageString)
        ) {
            PRODUCTS.push(messageString);
        }
        // if matches channel is not in channel list then add it
        addChannelHandler('matches');
        return subscribeToProducts(PRODUCTS, [CHANNEL_NAMES.matches], socket);
    }

    // Check if message is for unsubscribing a symbol
    if (messageString.charAt(messageString.length - 1) === 'U') {
        messageString = messageString.slice(0, -1);

        // if symbol is in products array filter it out and subscribe to the remaining symbols
        if (PRODUCTS.includes(messageString)) {
            PRODUCTS = PRODUCTS.filter((item) => item !== messageString);
            return subscribeToProducts(
                PRODUCTS,
                [CHANNEL_NAMES.matches],
                socket
            );
        }
    }

    // enter if message string is in product choices
    if (PRODUCT_CHOICES.includes(messageString)) {
        // if product is not in products array add it
        if (!PRODUCTS.includes(messageString)) {
            PRODUCTS.push(messageString);
        }
        // if ticker channel is not in channel list then add it
        addChannelHandler('ticker');
        return subscribeToProducts(PRODUCTS, [CHANNEL_NAMES.ticker], socket);
    }
}

// transforming data so it displays as stated in exam instructions
function transformDataObject(object) {
    let newObject;
    if (object.type === 'ticker') {
        newObject = {
            product_id: object.product_id,
            price: object.price,
            best_bid: object.best_bid,
            best_ask: object.best_ask,
        };
    }

    if (object.type === 'match' || object.type === 'last_match') {
        newObject = {
            timestamp: object.time,
            product_id: object.product_id,
            trade_size: object.size,
            price: object.price,
        };
    }

    return newObject;
}

const server = app.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});

// once handshake is complete emit websocket server connection
server.on('upgrade', (req, socket, head) => {
    socket.on('error', preSocketErrorHandler);
    wss.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener('error', preSocketErrorHandler);
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws, req) => {
    ws.on('error', postSocketErrorHandler);
    console.log('wss connection open');

    // create for each connection
    let PRODUCTS = [];
    let CONNECTIONS = [];
    let RATE_LIMIT = rateLimit(1, 250);

    ws.on('message', (msg, isBinary) => {
        wss.clients.forEach((client) => {
            if (ws === client && client.readyState === WebSocket.OPEN) {
                // close all other websocket connections before opening new one
                CONNECTIONS.forEach((ws) => ws.close());
                const dataSocket = new WebSocket(`${WEBSOCKET_URL}`);
                CONNECTIONS.push(dataSocket);

                // open data websocket
                dataSocket.on('open', () => {
                    // close connections and socket if message is quit from client
                    if (msg.toString('utf8') === 'quit') {
                        closeConnections(CONNECTIONS);
                        dataSocket.close();
                        PRODUCTS.length = 0;
                        console.log('connection closed with quit');
                        client.send('quit');
                    }

                    // if message is system send the subscribed products and close connection so message doesn't get lost

                    if (msg.toString('utf8').includes('system')) {
                        // return if just system else slice number from string
                        if (msg.toString('utf8') === 'system') {
                            closeConnections(CONNECTIONS);
                            dataSocket.close();
                            client.send(
                                JSON.stringify({
                                    product_ids_subscribed: PRODUCTS,
                                })
                            );
                        } else {
                            // set rate limit
                            let number = msg.toString('utf8').slice(6);
                            RATE_LIMIT = rateLimit(1, number);
                            return subscribeToProducts(
                                PRODUCTS,
                                [CHANNELS[0]],
                                dataSocket
                            );
                        }
                    }

                    // logs for error handling
                    console.log('opening data server');
                    console.log(CHANNELS);
                    verifyProductsSubscriptionHandler(
                        msg,
                        dataSocket,
                        PRODUCTS,
                        RATE_LIMIT
                    );
                });

                dataSocket.on('message', (data) => {
                    // don't send messages that exceed rate limit
                    if (RATE_LIMIT(dataSocket)) return;

                    // convert data to object
                    let objectData = JSON.parse(data.toString('utf8'));

                    // Function to transform object to correct output
                    let newObject = transformDataObject(objectData);

                    // client.send(JSON.stringify(objectData));
                    client.send(JSON.stringify(newObject));
                });

                dataSocket.on('close', () => {
                    dataSocket.terminate();
                    console.log('closed data server');
                });
            }
        });
    });

    ws.on('close', () => {
        console.log('wss connection closed');
    });
});
