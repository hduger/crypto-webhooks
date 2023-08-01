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
                // connect to data websocket
                const dataSocket = new WebSocket(`${WEBSOCKET_URL}`);
                dataSocket.on('open', () => {
                    console.log('opening data server');
                    dataSocket.send(
                        JSON.stringify({
                            type: 'subscribe',
                            channels: ['ticker'],
                            product_ids: ['BTC-USD'],
                        })
                    );
                });

                dataSocket.on('message', (data) => {
                    console.log('sending data');
                    client.send(JSON.stringify(data));
                });
            }
        });
    });

    ws.on('close', () => {
        console.log('connection closed');
    });
});
