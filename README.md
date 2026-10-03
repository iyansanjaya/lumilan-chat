# Lumilan Chat

**English** · [Bahasa Indonesia](README.id.md)

A cross-device chat app for Windows, macOS, and Linux. Discover people on your local network, send direct messages, create invitation-only Rooms, and send Announcements without accounts or a chat server.

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

## Download

Get the latest package from [Releases](https://github.com/iyansanjaya/lumilan-chat/releases/latest):

> [!WARNING]
> **Unsigned packages — download only from the official source.** Current packages are unsigned, so Windows or macOS may show a publisher warning. Download Lumilan Chat **only** from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases/latest). Do not install copies from other links. The maintainer cannot verify third-party copies and accepts no responsibility for damage, data loss, or security risks caused by them.

| System | Package |
| --- | --- |
| Windows (64-bit) | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Select the Intel (x64) package in the release notes |
| macOS 13+ Apple Silicon | Select the Apple Silicon (arm64) package in the release notes |
| Linux (64-bit) | `*.AppImage` |

## Get started

1. Install and open Lumilan Chat on devices connected to the same LAN or Wi-Fi network.
2. Enter your name. Other connected devices appear in the direct message list.
3. Select a person for a direct conversation. Use **Create Room** to make an invitation-only Conversation Room or an Announcement Room. Your Announcement Room appears after creation and broadcasts to all active devices that allow announcements. Recipients see it when a message arrives.

On first launch, supported installed builds enable opening Lumilan Chat at computer sign-in by default. You can turn this off in **Settings → When the computer starts**.

## Privacy and network limits

Direct device connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are chosen by users; there is no verification of a person's identity. Data stored on the device is **not encrypted**. Use trusted networks and enable disk encryption if needed.

## Updates and help

Installed apps can check Releases from **Settings → Check for updates**. Windows installers and Linux AppImages can download updates and offer **Later** or **Restart and install**. On macOS, the app checks for a release and directs you to download and install the DMG manually; automatic installation is currently unavailable, including in signed builds.

Enable desktop notifications for alerts while minimized. To keep receiving messages after closing the window, enable **Keep running in tray**; a tray must be available. Enabled and ready Lumi replaces the system banner; loading, paused, disabled, or unavailable Lumi uses system notifications. Linux Wayland uses this system fallback. Mute and Do not disturb suppress alerts; screen lock and suspend defer them.

If **Test system notification** does not appear, check Lumilan Chat's notification permissions and Do not disturb settings on Windows, macOS, or your Linux desktop. A successful test means the system accepted the notification; it does not guarantee that it appeared on screen.

Found a problem? Use the **Report a bug** icon in the app header or open [GitHub Issues](https://github.com/iyansanjaya/lumilan-chat/issues).

Developed by [Iyan Sanjaya](https://iyansanjaya.com/).

The **Support the App** icon in the header offers [Trakteer for Indonesia](https://trakteer.id/iyansanjaya/tip) and [Ko-fi for international supporters](https://ko-fi.com/iyansanjaya). Contributions of any size help keep Lumilan Chat improving.
