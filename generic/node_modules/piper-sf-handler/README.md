## Quick start

1. Install [Node.JS](http://nodejs.org/) on your computer.

2. Setup your project 

    Create a new Node.JS app :
    
    ```bash
    $ mkdir myapp
    $ cd myapp
    $ npm init
    ...
    ```
    
    Add node-piper as a dependency in your package.json
    
    ```json
      "dependencies": {
        "piper-mgr": "0.1.0"	
      },	
    ```
    
    Execute `npm install` in your current folder to fetch the dependencies
    
    Create an `index.js` file in myapp directory containing:
    
    ```javascript
    var piper = require('piper-mgr');
    var ACCESS_TOKEN = "IQ77NWUPUMNBYEUEKRTWU3VDR5YSLHTA"; // A unique access token to authenticate your request
    
    console.log("Managing piper services with the Piper API");
    
    var client = {
        "name": "ACME Company",
        "handle": "acme",
        "slackToken": "xoxb-AB0923F-09LSDKFJWOFKLS-LKALIWE099",
        "adminContact": "Martin Don",
        "adminEmail": "mdon@acme.com",
      }

    piper.registerClient(ACCESS_TOKEN, client, function (err, res) {
        console.log("Response from Piper for registerClient: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });
    
    piper.connect(ACCESS_TOKEN, "acme", function (err, res) {
        console.log("Response from Piper for new connection: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    piper.disconnect(ACCESS_TOKEN, "acme", function (err, res) {
        console.log("Response from Piper for end connection: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    piper.getClient(ACCESS_TOKEN, "acme", function (err, res) {
        console.log("Response from Piper for retrieve client details: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    piper.getClients(ACCESS_TOKEN, function (err, res) {
        console.log("Response from Piper for retrieve all client details: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    piper.getConnection(ACCESS_TOKEN, "acme", function (err, res) {
        console.log("Response from Piper for retrieve connection details: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    piper.getConnections(ACCESS_TOKEN, function (err, res) {
        console.log("Response from Piper for retrieve all active connections: ");
        if (err) console.log("Error: ", err);
        console.log(JSON.stringify(res, null, " "));
    });

    ```

4. Start your app

```bash
$ node index.js
Response from Piper for registerClient:
Client acme successfully registered and activated

Response from Piper for new connection:
{
 "status": "Connected",
 "client": {
    "_id": "54f1d37614ef3039468cd086",
    "name": "ACME Company",
    "slackHandle": "acme",
    "slackToken": "xoxb-AB0923F-09LSDKFJWOFKLS-LKALIWE099",
    "adminContact": "Martin Don",
    "adminEmail": "mdon@acme.com"
    "isActive": true,
    "__v": 0
  }
}
...
```

## Examples


## API

### registerClient

The `registerClient` function registers a new client and activates a slack connection. The function takes 3 parameters:
- `access_token`: Your access token for authentication
- `client`: JSON object with details of the client you want to register
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
var client = {
    "name": "ACME Company",
    "handle": "acme",
    "slackToken": "xoxb-AB0923F-09LSDKFJWOFKLS-LKALIWE099",
    "adminContact": "Martin Don",
    "adminEmail": "mdon@acme.com",
  }

piper.registerClient(ACCESS_TOKEN, client, function (err, res) {
    console.log("Response from Piper for registerClient: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### connect

The `connect` function creates a slack connection for a registered client. The function takes 3 arguments:
- `access_token`: Your access token for your instance
- `handle`: The unique slack handle of the clients slack instance <slackhandle>.slack.com
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.connect(ACCESS_TOKEN, "acme", function (err, res) {
    console.log("Response from Piper for new connection: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### disconnect

The `disconnect` function ends an active connection. The function takes 3 arguments:
- `access_token`: Your access token for your instance
- `handle`: The unique slack handle of the clients slack instance <slackhandle>.slack.com
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.disconnect(ACCESS_TOKEN, "acme", function (err, res) {
    console.log("Response from Piper for end connection: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### getClient

The `getClient` function retrieves the details of a registered client. The function takes 3 arguments:
- `access_token`: Your access token for your instance
- `handle`: The unique slack handle of the clients slack instance <slackhandle>.slack.com
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.getClient(ACCESS_TOKEN, "acme", function (err, res) {
    console.log("Response from Piper for retrieve client details: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### getClients

The `getClients` function retrieves an array of all registered clients. The function takes 2 arguments:
- `access_token`: Your access token for your instance
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.getClients(ACCESS_TOKEN, function (err, res) {
    console.log("Response from Piper for retrieve all client details: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### getConnection

The `getConnection` function retrieves the details of an active connection for a registered client. The function takes 3 arguments:
- `access_token`: Your access token for your instance
- `handle`: The unique slack handle of the clients slack instance <slackhandle>.slack.com
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.getConnect(ACCESS_TOKEN, "acme", function (err, res) {
    console.log("Response from Piper for retrieve connection details: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```

### getConnections

The `getConnections` function retrieves an array of all registered connections. The function takes 2 arguments:
- `access_token`: Your access token for your instance
- `callback(error, response)`: A callback function get 2 arguments:
    1. An `error` when applicable
    2. A JSON object containing the Piper response
    
```javascript
var piper = require('piper-mgr');
piper.getConnections(ACCESS_TOKEN, function (err, res) {
    console.log("Response from Piper for retrieve all active connections: ");
    if (err) console.log("Error: ", err);
    console.log(JSON.stringify(res, null, " "));
});
```