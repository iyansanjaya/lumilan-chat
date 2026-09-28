# Lumilan Chat

**English** · [Bahasa Indonesia](README.id.md)

A cross-device chat app for Windows, macOS, and Linux. Discover people on your local network, send direct messages, create invitation-only Rooms, and send Announcements without accounts or a chat server.

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

## Download

Get the latest package from [Releases](https://github.com/iyansanjaya/lumilan-chat/releases/latest):

| System | Package |
| --- | --- |
| Windows (64-bit) | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Select the Intel (x64) package in the release notes |
| macOS 13+ Apple Silicon | Select the Apple Silicon (arm64) package in the release notes |
| Linux (64-bit) | `*.AppImage` |

> [!WARNING]
> **Unsigned packages — download only from the official source.** Current packages are unsigned, so Windows or macOS may show a publisher warning. Download Lumilan Chat **only** from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases/latest). Do not install copies from other links. The maintainer cannot verify third-party copies and accepts no responsibility for damage, data loss, or security risks caused by them.

## Get started

1. Install and open Lumilan Chat on devices connected to the same LAN or Wi-Fi network.
2. Enter your name. Other connected devices appear in the direct message list.
3. Select a person for a direct conversation. Use **Create Room** to make an invitation-only Conversation Room or an Announcement Room. Your Announcement Room appears after creation and broadcasts to all active devices that allow announcements. Recipients see it when a message arrives.

Click a connected person's photo in the chat header or details panel to view it larger. Room members' photos can also be opened from the details panel.

For a routed local subnet where devices do not appear automatically, open **Connect a device** on the destination, copy its device code, and paste it on the other device. Both sides must be reachable over TCP port **40754**. A code includes the private IPv4 address, port, and authenticated device ID. The app has no internet relay or global chat service.

Files can be sent in direct messages and Conversation Rooms, up to **500 MB per file**. Each online recipient must approve a Room file; delivery may succeed for some members and fail for others. Announcement Rooms do not allow files. The sender needs space for a temporary copy, and each receiver needs space for the file plus a 10 MB reserve; failed transfers do not resume automatically. Devices running the previous chunked-transfer version accept up to **100 MB**; older clients without chunked transfer retain the **20 MB** direct-message limit. Files over 100 MB require the 500 MB version on both devices. The composer includes an emoji picker. Once a transfer completes, Lumilan creates a small local thumbnail on demand for PNG, JPEG, and WebP images up to 40 megapixels and 100 MB in source size. The original remains downloadable; unsupported, damaged, or larger images and GIFs remain attachments. Thumbnails are deleted with conversation history. Lumilan does not use an online media service. The initial UI language follows the device region: Indonesia → Bahasa Indonesia, Malaysia → Bahasa Melayu, Spain → Español, Japan → 日本語, South Korea → 한국어, China/Singapore → 简体中文, Taiwan/Hong Kong/Macau → 繁體中文, and other regions → English. You can also choose a language manually in Settings. Chat history and files remain on each device. Devices that are offline do not receive messages sent while they are disconnected.

The creator can delete a Conversation Room through **Manage / Delete Room**, including while the Room is archived; members can choose **Leave Room**. Type `@` in **Create Room** to select online devices. After creating an Announcement Room, **Create Room** remains available for other Conversation Rooms; the Announcement option returns after its Room is deleted. An Announcement Room can be deleted from **Conversation options** and created again when needed. Use **Archive conversation** to hide a direct chat, Room, or Announcement. In the **Archive** filter, you can read and restore conversations; **Permanently delete history** removes messages and files from Lumilan Chat data on this device. Direct message history can be deleted without archiving first. For an archived Announcement Room, this also deletes the Room so it can be created again; a Conversation Room remains until its creator chooses **Delete Room**. History from deleted or left Rooms remains in Archive until deleted there. Downloaded copies, backups, and data on other devices are unaffected. Direct and Room chats show a temporary typing indicator.

## Privacy and network limits

Direct device connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are chosen by users; there is no verification of a person's identity. Data stored on the device is **not encrypted**. Use trusted networks and enable disk encryption if needed.

Automatic discovery uses mDNS on the LAN and usually stays on one link. Routed private IPv4 subnets can use a device code when the network permits direct TCP; firewalls and VLAN isolation can still block access. VPN address ranges such as 100.64.0.0/10 are not supported. Conversation Rooms require invitation acceptance, and the creator manages members; offline members learn membership changes after reconnecting to the creator. Recipients can read Announcements without creating a room, but must create their own Announcement Room before sending. Announcements can be disabled in Settings. Older clients cannot use Rooms or Announcements.

## Updates and help

Installed apps can check Releases from **Settings → Check for updates**. On macOS, the app currently checks for a release and directs you to download and install the DMG manually. Automatic installation on macOS requires signed packages and update metadata published with the release.

If **Test system notification** does not appear, check Lumilan Chat's notification permissions and Do not disturb settings on Windows, macOS, or your Linux desktop. A successful test means the system accepted the notification; it does not guarantee that it appeared on screen.

Found a problem? Use the **Report a bug** icon in the app header or open [GitHub Issues](https://github.com/iyansanjaya/lumilan-chat/issues).

Developed by [Iyan Sanjaya](https://iyansanjaya.com/).

The **Support the App** icon in the header offers [Trakteer for Indonesia](https://trakteer.id/iyansanjaya/tip) and [Ko-fi for international supporters](https://ko-fi.com/iyansanjaya). Contributions of any size help keep Lumilan Chat improving.
