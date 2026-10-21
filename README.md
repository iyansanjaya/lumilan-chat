<p align="center"><img src="build/icon.png" alt="Lumilan Chat" width="80" height="80"></p>

<h1 align="center">Lumilan Chat</h1>
<p align="center"><strong>Your network. Your conversations.</strong><br>Direct chat, shared files, voice calls, and reminders for your local workspace.</p>
<p align="center"><a href="https://github.com/iyansanjaya/lumilan-chat/releases/latest"><strong>Download Lumilan Chat</strong></a> · <a href="https://github.com/iyansanjaya/lumilan-chat/issues">Report a problem</a> · <a href="README.id.md">Bahasa Indonesia</a></p>

![Windows](https://img.shields.io/badge/Windows-64--bit-0078D4) ![macOS](https://img.shields.io/badge/macOS-Intel%20%26%20Apple%20Silicon-333333) ![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?labelColor=333333) ![Local network](https://img.shields.io/badge/Network-LAN-FFD36D?labelColor=333333)

Lumilan connects devices directly on the same LAN or Wi-Fi. No accounts, central chat server, or internet relay. Open the app, choose a name, and start a conversation.

![Lumilan Chat in light mode — direct conversation on an isolated demo network](docs/screenshots/chat-light.png)

## A workspace that stays close

| Connect | Make it yours |
| --- | --- |
| **Direct messages & invitation-only Rooms** — talk privately or bring a team together. | **Personal notes** — keep messages and attachments on your own device. |
| **File sharing & image paste** — transfer each file up to 5 GB to compatible clients; paste a copied image, review it, and select Send. | **Reminders** — schedule your own tasks or ask an online contact to choose and accept a time. |
| **Voice calls** — one-to-one audio over your local network. | **Lumi** — a Dynamic Island-style pill with the time that opens into pages, and alerts whenever you are not looking at Lumilan, with system notification fallback where needed. |
| **Link previews** — static cards for YouTube, Shorts, and Instagram links (Instagram when available without login); Facebook, Threads, and X get a link card. | **Opt-in fetching** — only your device contacts YouTube or Instagram, and only after you turn it on. |
| **Focus sessions** — start 25, 45, or 60 minutes from Lumi or Settings; contacts see Do not disturb, and your previous status returns afterward. | **One quiet summary** — messages wait during the session; at the end you see how many arrived, without names, text, or marking them read. |
| **Water routine & tasks** — log a drink, get reminders during your active hours, and tick off tasks from Lumi or Settings. | **File shelf** — drop files on Lumi to keep them close, drag them out, send them to a contact, or save them to Personal notes. |

<details>
<summary><strong>See dark mode and settings</strong></summary>

![Lumilan Chat in dark mode](docs/screenshots/chat-dark.png)

![Profile and appearance settings](docs/screenshots/settings.png)

Screenshots use isolated demo profiles and local test devices; they contain no user conversations.

</details>

## Download

> [!WARNING]
> **Current packages are unsigned.** Windows or macOS may show a publisher warning. Download only from the official Releases page. Third-party copies cannot be verified by the maintainer; the maintainer accepts no responsibility for damage, data loss, or security risks caused by them.

Get the latest package from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases/latest).

| System | Choose this package |
| --- | --- |
| Windows 64-bit | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Intel / x64 DMG |
| macOS 13+ Apple Silicon | Apple Silicon / arm64 DMG |
| Linux 64-bit | `*.AppImage` |

Platform-specific features depend on the installed package and desktop environment. Lumi is implemented for Windows, macOS Intel/Apple Silicon, and Linux X11; on Macs with a camera notch it covers the notch above the menu bar, and Linux Wayland uses system notifications. Build success alone does not establish native compatibility for every feature.

## Start in three steps

1. **Open Lumilan** on devices connected to the same LAN or Wi-Fi.
2. **Choose your name.** Connected devices appear in the direct message list.
3. **Start talking.** Select a person, or use **Create Room** for an invitation-only Conversation Room or an Announcement Room.

Announcement Rooms broadcast to active devices that allow announcements. Direct messages, Room messages, and file transfers require reachable recipients; they are not queued for offline delivery. Reminder contacts are shown only while online and supporting the feature. Personal reminders work locally; requests already created retain their delivery or decision state if a connection drops.

On first launch, supported installed builds enable opening at computer sign-in. Change this in **Settings → When the computer starts**. To keep receiving messages after closing the window, enable **Keep running in tray**; a tray must be available.

## Privacy and network limits

Connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are self-chosen and do not verify a person's identity. Local history, files, and settings are **not encrypted**; use trusted networks and disk encryption where needed.

Discovery depends on local mDNS, and direct traffic must be allowed by firewalls and Wi-Fi/VLAN rules. Lumilan has no internet relay to bypass network isolation. Voice calls need microphone access and direct local UDP traffic.

Focus sessions are off until you choose a length in **Settings → Focus**; while one runs, connected contacts see your status as Do not disturb. Water logs, tasks, and the shelf stay on your device; the shelf keeps only where each file is and never deletes a file. Lumi's pill stays at the top of the screen while you use the app; **Settings → Notifications** can show it only when you are not looking at the window. Dropping files on Lumi is tested on Windows; on macOS and Linux use the open panel or **Settings → Shelf**. Link previews are optional. After you turn them on, only the sending device contacts YouTube or Instagram over HTTPS to fetch a title and thumbnail; recipients receive the card over the LAN and never go online. Facebook, Threads, and X links get a card made on your device without any connection.

## Help Lumilan grow

Developed by [Iyan Sanjaya](https://iyansanjaya.com/). Found a problem? Use **Report a bug** in the app header or [open an issue](https://github.com/iyansanjaya/lumilan-chat/issues).

[![Trakteer](docs/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

Contributions of any size help keep Lumilan improving. The **Support the App** icon offers Trakteer for Indonesia and Ko-fi for international supporters.
