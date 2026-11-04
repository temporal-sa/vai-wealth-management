# React Web App for Wealth Management

An easy to use web based front end for the Wealth Management Agent. 
It uses the [API](../api/README.md) to interact with Temporal.

## Prerequisites 

[Node.js](https://nodejs.org/en/download): Version 20.0.0 or higher.

The web application relies on the API to communicate with Temporal. 
Be sure to follow the instructions to run the API, which can be found [here](../api/README.md)

Note that the web application communicates directly with the API and the API is what 
communicates with Temporal running locally or in the cloud.

## Install Dependencies
From the project root:
```bash
cd frontend
npm install
```

## Running the Web App
```bash
cd frontend
npm start
```

Click **Chaos** in the header to open the chaos panel, which injects failures to show how Temporal
recovers (see [Failure scenarios](../src/temporal_supervisor/README.md#failure-scenarios-chaos-panel)).

When you open a new investment account, approve the compliance review in another terminal with
either 
### Send the Compliance Reviewed Signal (Local)
```bash
cd src/temporal_supervisor
./localsendcomplianceapproval.sh <Child Workflow ID>
```

or
### Send the Compliance Reviewed Signal (Cloud)
```bash
cd src/temporal_supervisor
./cloudsendcomplianceapproval.sh <Child Workflow ID>
```

## Example

Here's an example screenshot of the web application running:

![](../images/webui.png)

## Comments

This example uses a fixed Workflow ID to simplify some of the functionality for a demo.
