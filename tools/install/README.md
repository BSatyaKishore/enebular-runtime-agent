
# enebular-agent Install Script

*Read this in other languages: [English](README.md), [日本語](README.ja.md)*

This is a bash script based utility that offers one-step installation of eneblar-agent on Debian based systems.

## Install Locally

To use the install script directly on a target device, you can download it with wget and then run it as shown below.

```sh
wget -qO- https://enebular.com/agent-install | sudo -E bash -s
```

## Install Remotely

The install script can also be run on a remote target device via SSH with the following command pattern.

```sh
ssh -t <user>@<device-ip-address> "wget -qO- https://enebular.com/agent-install | sudo -E bash -s"
```

For example, to run the script on a remote Raspberry Pi with the default `pi` user and an IP address of `192.168.1.125,` the command would be as follows.

```sh
ssh -t pi@192.168.1.125 "wget -qO- https://enebular.com/agent-install | sudo -E bash -s"
```

## User

By default enebular-agent is installed so that it runs as the `enebular` user. The install script will create the user if it doesn't already exist.

## Port

By default the AWS IoT port of enebular-agent is installed. See the *Options* section below for alternatives.

## AWS IoT Thing Creation

The install script provides the ability to automatically create a Thing on AWS IoT for enebular-agent to use.

To create a Thing, the following four options must be specified:

```sh
--aws-access-key-id
--aws-secret-access-key
--aws-iot-region
--aws-iot-thing-name
```

It's best to only use this feature when running the script remotely to avoid having the secret access key recorded on the device (in the bash history).

The generated keys and certificates will be stored in `/home/enebular/enebular-runtime-agent/ports/awsiot/certs` by default. The user must make sure the keys and certificates are backed up securely if necessary.

See the *Examples* section below for an example of a command to create an AWS IoT thing.

## Activtion

The install script will create the activation configuration file for enebular-agent if the `--license-key` option is provided.

## Manual Port Configuration

While this script will fully install enebular-agent and set it up to run at system startup, as enebular-agent also needs additional configuration specific to the selected port, if you didn't select to automatically add an AWS IoT thing then enebular-agent will actually fail to run to start with.

To have enebular-agent run correctly, add the required files for the port (in the correct location and with the correct user permissions) as specified in the enebular-agent readme files and then restart enebular-agent.

See the *Post Install* section below for information on how to restart enebular-agent and check its runtime state.

## Post Install

Once installed, you should be able to check the status of the enebular-agent with the systemd journal using the following command pattern.

```sh
sudo journalctl -ex -u enebular-agent-<user>.service
```

With the default `enebular` user, the command to use is:

```sh
sudo journalctl -ex -u enebular-agent-enebular.service
```

To restart enebular-agent, use the following command.

```sh
sudo systemctl restart enebular-agent-enebular.service
```

## Node.js Version

The supported Node.js version is as defined in the offical enebular documentation. If the install script can't find an existing installation of this version, it will try to install a prebuilt release from nodejs.org.

## Options

```sh
OPTION                      FORMAT              DEFAULT                              DESCRIPTION
-p or --port                -p=[local,awsiot]   awsiot                               Port to install
-u or --user                -u=*                enebular                             User to run as after being installed
-d or --install-dir         -d=<path>           /home/<user>/enebular-runtime-agent  Install directory
-v or --release-version     -v=*                The latest release                   Release version of enebular-agent
--no-startup-register       N/A                 N/A                                  Do not register system startup configuration
--aws-access-key-id         =*                  N/A                                  AWS access key ID
--aws-secret-access-key     =*                  N/A                                  AWS secret access key
--aws-iot-region            =*                  N/A                                  AWS IoT region
--aws-iot-thing-name        =*                  N/A                                  AWS IoT thing name
--license-key               =*                  N/A                                  Enebular licence key to activate
```

## Examples

Install the AWS IoT enebular-agent port and create a AWS IoT thing named "raspberry-pi" on a Raspberry Pi device via SSH (with the `pi` user and IP address of `192.168.1.125`).

```sh
ssh -t pi@192.168.1.125 "wget -qO- https://enebular.com/agent-install | sudo -E bash -s -- --aws-iot-thing-name=raspberry-pi --aws-access-key-id=<my-key-id> --aws-secret-access-key=<my-access-key> --aws-iot-region=<my-region>"
```

Install the AWS IoT enebular-agent port using the `2.1.2` release.

```sh
wget -qO- https://enebular.com/agent-install | sudo -E bash -s -- -v=2.1.2
```

Install the AWS IoT enebular-agent port using the `2.1.3` release with the user set to `enebular-user-test`, the install directory set to `/home/enebular-user-test/my-agent`, and startup registration disabled.

```sh
wget -qO- https://enebular.com/agent-install | sudo -E bash -s -- -v=2.1.3 --user=enebular-user-test -d=/home/enebular-user-test/my-agent --no-startup-register
```
