<p align="center"><img src="build/icon.png" alt="Lumilan Chat" width="80" height="80"></p>

<h1 align="center">Lumilan Chat</h1>
<p align="center"><strong>Your network. Your conversations.</strong><br>Direct chat, shared files, voice calls, and reminders for your local workspace.</p>
<p align="center"><a href="https://github.com/iyansanjaya/lumilan-chat/releases/latest"><strong>Download Lumilan Chat</strong></a> · <a href="https://github.com/iyansanjaya/lumilan-chat/issues">Report a problem</a> · <a href="README.id.md">Bahasa Indonesia</a></p>

![Windows](https://img.shields.io/badge/Windows-64--bit-0078D4) ![macOS](https://img.shields.io/badge/macOS-Intel%20%26%20Apple%20Silicon-333333) ![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?labelColor=333333) ![Local network](https://img.shields.io/badge/Network-LAN-FFD36D?labelColor=333333)

Lumilan connects devices directly on the same LAN or Wi-Fi. No accounts, central chat server, or internet relay. Open the app, choose a name, and start a conversation.

![Lumilan Chat in light mode — direct conversation on an isolated demo network](docs/screenshots/chat-light-en.png)

## Meet Lumi

Lumi is a small black island that hangs from the top edge of your screen. When something arrives while you are in another app, it grows into a card, then shrinks back to a pill with the time. It never takes the keyboard from the app you are using, and it waits during Do not disturb, mute, a locked screen, and sleep.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/lumi-message-open-en.png" alt="Lumi open on a message from Design team"><br><sub><b>Messages, files, and calls</b>: open the conversation, accept or decline a file, answer a call.</sub></td>
<td width="50%"><img src="docs/screenshots/lumi-volume-en.png" alt="Lumi's volume bar at 64%"><br><img src="docs/screenshots/lumi-bluetooth-en.png" alt="Lumi: Studio Headphones connected"><br><sub><b>Your devices</b>: the volume bar follows your volume keys, scroll over Lumi to change it, and headphones or Wi-Fi changes show at a glance.</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/lumi-focus-en.png" alt="Lumi's Focus page with a running session"><br><sub><b>Focus</b>: 25, 45, or 60 minutes; contacts see Do not disturb.</sub></td>
<td><img src="docs/screenshots/lumi-tasks-en.png" alt="Lumi's Tasks page"><br><sub><b>Tasks</b>: add and tick off tasks without opening the window.</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/lumi-shelf-en.png" alt="Lumi's Shelf page with two files"><br><sub><b>Shelf</b>: drop files on Lumi, drag them out, or send them to a contact.</sub></td>
<td><img src="docs/screenshots/lumi-devices-en.png" alt="Lumi's Devices page"><br><sub><b>Devices</b>: displays, Wi-Fi, Bluetooth, and volume, read on your computer only.</sub></td>
</tr>
</table>

## A workspace that stays close

| Connect | Make it yours |
| --- | --- |
| **Direct messages & invitation-only Rooms** — talk privately or bring a team together. | **Personal notes** — keep messages and attachments on your own device. |
| **File sharing & image paste** — transfer each file up to 5 GB to compatible clients; paste a copied image, review it, and select Send. | **Reminders** — schedule your own tasks or ask an online contact to choose and accept a time. |
| **Voice calls** — one-to-one audio over your local network. | **Lumi** — a Dynamic Island-style pill with the time that opens into pages, and alerts whenever you are not looking at Lumilan, with system notification fallback where needed. Keep the pill, or let Lumi appear only when something arrives; **Ctrl+Shift+L** (**⌘⇧L**) opens it from any app. |
| **Link previews** — static cards for YouTube, Shorts, and Instagram links (Instagram when available without login); Facebook, Threads, and X get a link card. | **Opt-in fetching** — only your device contacts YouTube or Instagram, and only after you turn it on. |
| **Focus sessions** — start 25, 45, or 60 minutes from Lumi or Settings; contacts see Do not disturb, and your previous status returns afterward. | **One quiet summary** — messages wait during the session; at the end you see how many arrived, without names, text, or marking them read. |
| **Water routine & tasks** — log a drink, get reminders during your active hours, and tick off tasks from Lumi or Settings. | **File shelf** — drop files on Lumi to keep them close, drag them out, send them to a contact, or save them to Personal notes. Lumi's **Devices** page shows displays, Wi-Fi, Bluetooth, and volume at a glance, and Lumi shows a volume bar, Bluetooth names, and Wi-Fi changes as they happen; scroll over Lumi to change the volume (macOS: wheel only, no live volume keys or Bluetooth yet). |
| **Stickers** — import your own image packs and send them from the composer picker; packs stay on your device. | **Shows up at once** — small stickers need no accept step; the receiving device checks and re-encodes every image. |
| **Work breaks** — choose how long to work and rest; Lumi reminds you, then every screen dims with a countdown. | **Back to work anytime** — snooze, skip, or end a break early; breaks wait during Do not disturb, calls, lock, and sleep. |

<details>
<summary><strong>See dark mode and settings</strong></summary>

![Lumilan Chat in dark mode](docs/screenshots/chat-dark-en.png)

![Settings, Lumi category](docs/screenshots/settings-en.png)

Screenshots come from the Windows build with isolated demo profiles, local test devices, and demo device names; they contain no user conversations.

</details>

## Download

> [!WARNING]
> **Current packages are unsigned.** Windows or macOS may show a publisher warning. Download only from the official Releases page. Third-party copies cannot be verified by the maintainer; the maintainer accepts no responsibility for damage, data loss, or security risks caused by them.

Get the latest package from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases/latest). After an update, **Settings → App → What's new** opens once to show what changed.

| System | Choose this package |
| --- | --- |
| Windows 64-bit | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Intel / x64 DMG |
| macOS 13+ Apple Silicon | Apple Silicon / arm64 DMG |
| Linux 64-bit | `*.AppImage` |

Platform-specific features depend on the installed package and desktop environment. Lumi is implemented for Windows, macOS Intel/Apple Silicon, and Linux X11; on macOS it hangs from the top edge of the screen over the menu bar and covers the camera notch where there is one, and Linux Wayland uses system notifications. Build success alone does not establish native compatibility for every feature.

## Start in three steps

1. **Open Lumilan** on devices connected to the same LAN or Wi-Fi.
2. **Choose your name.** Connected devices appear in the direct message list.
3. **Start talking.** Select a person, or use **Create Room** for an invitation-only Conversation Room or an Announcement Room.

Announcement Rooms broadcast to active devices that allow announcements. Direct messages, Room messages, and file transfers require reachable recipients; they are not queued for offline delivery. Reminder contacts are shown only while online and supporting the feature. Personal reminders work locally; requests already created retain their delivery or decision state if a connection drops.

On first launch, supported installed builds enable opening at computer sign-in. Change this in **Settings → App → When the computer starts**. To keep receiving messages after closing the window, enable **Keep running in tray**; a tray must be available.

## Privacy and network limits

Connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are self-chosen and do not verify a person's identity. Local history, files, and settings are **not encrypted**; use trusted networks and disk encryption where needed.

## Help Lumilan grow

Developed by [Iyan Sanjaya](https://iyansanjaya.com/). Found a problem? Use **Report a bug** in the app header or [open an issue](https://github.com/iyansanjaya/lumilan-chat/issues).

[![Trakteer](docs/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

Contributions of any size help keep Lumilan improving. The **Support the App** icon offers Trakteer for Indonesia and Ko-fi for international supporters.
