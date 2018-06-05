
# enebular-agent

*Read this in other languages: [English](README.md), [日本語](README.ja.md)*

enebular-agent is Node.js based enebular IoT agent software for Linux gateways. enebular-agent works together with enebular to allow Node-RED flows to be deployed to and executed on the IoT device, and for the status of the IoT device to be reported back to enebular.

enebular-agent has the following key functionality.

- IoT device (agent) activation, registration and authentication.
- Management of a Node-RED instance, and deployment and execution of flows sent from enebular to that.
- Status and log reporting to enebular.

enebular communicates with enebular-agent via a third-party IoT platform connection.

## Features

### Activation, Registration and Authentication

To communicate with enebular, enebular-agent needs to receive its required device 'registration' information. This can occur in one of two supported ways.

- enebular automatically sends it to enebular-agent via the IoT platform connection
- enebular-agent receives it in response to it directly requesting 'activation' with enebular.

In most cases the first method is used. For more information on using activation, see the [activation readme](README-activation.md).

enebular will also automatically update the enebular-agent's authentication information when required to allow it to use 'paid' device features (i.e logging and status reporting).

### Node-RED Flows

enebular-agent accepts flows deployed from enebular and manages a Node-RED instance to run them. It will also automatically install any published node modules that are depended on by the flow being deployed.

### Logging

enebular-agent will periodically send logged messages to enebular (when it has been made a 'paid' device). It can also log to its own standard output streams (command-line console), but this is not enabled by default. To have it also log to the console, set the `DEBUG` environment variable.

Along with its own logging, enebular-agent captures and re-logs any messages that Node-RED logs to its standard output streams (stdout and stderr). This includes any messages from nodes in the flow being run which log to the console, like when the debug node is configured to log to the "debug tab and console". All messages captured from Node-RED are currently re-logged at the 'info' log level.

### Status Reporting

enebular-agent provides simple reporting on its status to enebular (when it has been made a 'paid' device).

## Structure

enebular-agent is implemented as a collection of Node.js modules. Its core runtime functionality is implemented as the `enebular-runtime-agent` module (under the `agent` directory). On top of this, there is a module for each of the supported IoT platform connection types (under the `ports` directory). Each of the ports includes the enebular-runtime-agent core module as a dependency.

Node-RED is also installed as a Node.js module.

## Installation

To run enebular-agent you need to install the Node.js modules required by the IoT platform port [1] you want to use and also correctly configure the IoT platform's connection details.

The required modules and connection configuration differs for each IoT platform port. Please see the readme files of each port for details on how to set up and run the enebular-agent.

- [Ports](ports)

[1]: Here a 'port' refers to the individual enebular-agent editions created to allow it to work with external services such as AWS IoT and Mbed Cloud.

## Configuration

enebular-agent supports a number of configuration options set via environment variables that are available no matter what IoT platform port is used. This includes the following.

- `DEBUG` - Have enebular-agent log to the console at the specified log level (i.e. `debug` or `info` etc). Note that if set to `debug` then debug messages will also be sent to enebular (when enebular-agent is authenticated).

- `NODE_RED_DIR` - The path of the installed Node-RED instance.

- `NODE_RED_DATA_DIR` - The path to use as Node-RED's working data (userDir) directory.

- `NODE_RED_COMMAND` - The command to use to start Node-RED.

- `ENEBULAR_CONFIG_PATH` - The path of the enebular-agent's main configuration file.

Each of the ports have additional configuration options. Please see the readme files of each port for details.
