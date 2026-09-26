# Lumilan Chat

**English** · [Bahasa Indonesia](README.id.md)

A cross-device chat app for Windows, macOS, and Linux. Discover people on your local network, send direct or general room messages, and share files in direct messages without accounts or a chat server.

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

## Download

Get the latest package from [Releases](https://github.com/iyansanjaya/lumilan-chat/releases/latest):

| System | Package |
| --- | --- |
| Windows (64-bit) | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Select the Intel (x64) package in the release notes |
| macOS 13+ Apple Silicon | Select the Apple Silicon (arm64) package in the release notes |
| Linux (64-bit) | `*.AppImage` |

Packages may currently be unsigned. Windows or macOS may show a publisher warning. Make sure your download comes from the official Releases page above.

## Get started

1. Install and open Lumilan Chat on devices connected to the same LAN or Wi-Fi network.
2. Enter your name. Other connected devices appear in the direct message list.
3. Select a person for a direct conversation, or open the **General room** to message active devices in the current network session.

Files can only be sent in direct messages, up to **100 MB per file**, and require recipient approval. Both devices need enough free space; failed transfers do not resume automatically. If the recipient uses an older version, the limit is **20 MB**. The initial UI language follows the device region: Indonesia → Bahasa Indonesia, Malaysia → Bahasa Melayu, Spain → Español, and other regions → English. You can also choose a language manually in Settings. Chat history and files remain on each device. Devices that are offline do not receive messages sent while they are disconnected.

## Privacy and network limits

Direct device connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are chosen by users; there is no verification of a person's identity. Data stored on the device is **not encrypted**. Use trusted networks and enable disk encryption if needed.

Automatic discovery uses mDNS on the LAN. Firewalls, VLANs, and VPNs can prevent discovery. Discovery across VPN subnets is not supported yet.

## Updates and help

Installed apps can check Releases from **Settings → Check for updates**. On macOS, the app currently checks for a release and directs you to download and install the DMG manually. Automatic installation on macOS requires signed packages and update metadata published with the release.

If **Test system notification** does not appear, check Lumilan Chat's notification permissions and Do not disturb settings on Windows, macOS, or your Linux desktop. A successful test means the system accepted the notification; it does not guarantee that it appeared on screen.

Found a problem? Use the **Report a bug** icon in the app header or open [GitHub Issues](https://github.com/iyansanjaya/lumilan-chat/issues).

Developed by [Iyan Sanjaya](https://iyansanjaya.com/).

The **Support the App** icon in the header offers [Trakteer for Indonesia](https://trakteer.id/iyansanjaya/tip) and [Ko-fi for international supporters](https://ko-fi.com/iyansanjaya). Contributions of any size help keep Lumilan Chat improving.