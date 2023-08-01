const WebSocket = require('ws');
require('dotenv').config();
const CryptoJS = require('crypto-js');
const express = require('express');
const SIGNING_KEY = process.env.API_SECRET;
const API_KEY = process.env.API_KEY;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
const PORT = process.env.PORT || 3000;

const app = express();

const wss = new WebSocket.Server({ noServer: true });
// const dataSocket = new WebSocket(`${WEBSOCKET_URL}`);

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

const PRODUCTS = ['BTC-USD'];

const server = app.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});

server.on('upgrade', (req, socket, head) => {
    socket.on('error', preSocketErrorHandler);
    wss.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener('error', preSocketErrorHandler);
        wss.emit('connection', ws, req);
    });
});

wss.on('connection', (ws, req) => {
    ws.on('error', postSocketErrorHandler);
    console.log('connection open');

    ws.on('message', (msg, isBinary) => {
        wss.clients.forEach((client) => {
            if (ws === client && client.readyState === WebSocket.OPEN) {
                // client.send(msg, { binary: isBinary });

                // convert message to string
                let jsonMsg = JSON.stringify(msg);
                let bufferOriginalMSG = Buffer.from(JSON.parse(jsonMsg).data);
                console.log(bufferOriginalMSG.toString('utf8'));
                PRODUCTS.push(bufferOriginalMSG.toString('utf8'));

                // connect to data websocket
                const dataSocket = new WebSocket(`${WEBSOCKET_URL}`);
                dataSocket.on('open', () => {
                    console.log('opening data server');
                    console.log(PRODUCTS);
                    // dataSocket.send(
                    //     JSON.stringify({
                    //         type: 'subscribe',
                    //         channels: ['ticker'],
                    //         product_ids: ['BTC-USD'],
                    //     })
                    // );
                    subscribeToProducts(PRODUCTS, ['ticker'], dataSocket);
                });

                dataSocket.on('message', (data) => {
                    // convert data to string
                    let jsonData = JSON.stringify(data);
                    let bufferOriginalData = Buffer.from(
                        JSON.parse(jsonData).data
                    );
                    let objectData = JSON.parse(
                        bufferOriginalData.toString('utf8')
                    );
                    if (objectData.type === 'ticker') {
                        let newObject = {
                            product_id: objectData.product_id,
                            price: objectData.price,
                            bid: objectData.best_bid,
                            ask: objectData.best_ask,
                        };
                        console.log(newObject);
                        // client.send(bufferOriginalData.toString('utf8'));
                        client.send(JSON.stringify(newObject));
                    }
                });

                dataSocket.on('close', () => {
                    dataSocket.send(
                        JSON.stringify({
                            type: 'unsubscribe',
                            channels: ['ticker'],
                            product_ids: ['BTC-USD'],
                        })
                    );
                    console.log('closed data server');
                });
            }
        });
    });

    ws.on('close', () => {
        console.log('connection closed');
    });
});
