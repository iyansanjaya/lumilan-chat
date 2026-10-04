<p align="center"><img src="build/icon.png" alt="Lumilan Chat" width="80" height="80"></p>

<h1 align="center">Lumilan Chat</h1>
<p align="center"><strong>Your network. Your conversations.</strong><br>Direct chat, shared files, voice calls, and reminders for your local workspace.</p>
<p align="center"><a href="https://github.com/iyansanjaya/lumilan-chat/releases/latest"><strong>Download Lumilan Chat</strong></a> · <a href="https://github.com/iyansanjaya/lumilan-chat/issues">Report a problem</a> · <a href="README.id.md">Bahasa Indonesia</a></p>

![Windows](https://img.shields.io/badge/Windows-64--bit-0078D4) ![macOS](https://img.shields.io/badge/macOS-Intel%20%26%20Apple%20Silicon-333333) ![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?labelColor=333333) ![Local network](https://img.shields.io/badge/Network-LAN-FFD36D?labelColor=333333)

Lumilan connects devices directly on the same LAN or Wi-Fi. No accounts, central chat server, or internet relay. Open the app, choose a name, and start a conversation.

![Lumilan Chat in light mode — direct conversation on an isolated demo network](build/screenshots/chat-light.png)

## A workspace that stays close

| Connect | Make it yours |
| --- | --- |
| **Direct messages & invitation-only Rooms** — talk privately or bring a team together. | **Personal notes** — keep messages and attachments on your own device. |
| **File sharing & image paste** — transfer files up to 5 GB to compatible clients; paste a copied image, review it, and select Send. | **Reminders** — schedule your own tasks or ask an online contact to choose and accept a time. |
| **Voice calls** — one-to-one audio over your local network. | **Lumi** — compact background alerts, with system notification fallback where needed. |

<details>
<summary><strong>See dark mode and settings</strong></summary>

![Lumilan Chat in dark mode](build/screenshots/chat-dark.png)

![Profile and appearance settings](build/screenshots/settings.png)

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

Platform-specific features depend on the installed package and desktop environment. Lumi is implemented for Windows, macOS Intel/Apple Silicon, and Linux X11; Linux Wayland uses system notifications. Build success alone does not establish native compatibility for every feature.

## Start in three steps

1. **Open Lumilan** on devices connected to the same LAN or Wi-Fi.
2. **Choose your name.** Connected devices appear in the direct message list.
3. **Start talking.** Select a person, or use **Create Room** for an invitation-only Conversation Room or an Announcement Room.

Announcement Rooms broadcast to active devices that allow announcements. Direct messages, Room messages, and file transfers require reachable recipients; they are not queued for offline delivery. Reminder contacts are shown only while online and supporting the feature. Personal reminders work locally; requests already created retain their delivery or decision state if a connection drops.

On first launch, supported installed builds enable opening at computer sign-in. Change this in **Settings → When the computer starts**. To keep receiving messages after closing the window, enable **Keep running in tray**; a tray must be available.

## Images, alerts, and updates

- **Copy an image, then paste it into the message box.** A preview appears before you select Send. Remove it with the × button. Clipboard images support PNG/JPEG/WebP/GIF up to 20 MB, 40 million pixels in total, and 120 frames. They use the existing file consent and integrity checks; Announcement Rooms do not accept attachments.
- **List entry:** Enter continues a numbered or bullet list; Enter on an empty item ends it. Outside lists, Enter sends and Shift + Enter adds a line. The Send button can send a list directly.
- **176 local emoji:** browse a scrollable picker with Tab or the arrow keys. Home/End selects the first/last item; Enter inserts it, and Escape closes the picker. Labels follow the app language.
- **Presence at a glance:** colored dots and avatar rings show status in the direct conversation list. Hover over a person's row or focus it with the keyboard for an immediate status tooltip; screen readers retain the status label.
- **Comfortable motion:** menus, dialogs, message bubbles, unread counts, and Lumi use brief, bounded animations. Reduced motion disables interface animations and transitions; the main interface pauses CSS animations while hidden.
- **Background alerts:** enabled and ready Lumi replaces the system banner. Loading, paused, disabled, or unavailable Lumi uses system notifications. Mute and Do not disturb suppress alerts; screen lock and suspend defer them.
- **Updates:** use **Settings → Check for updates**. Windows installers and Linux AppImages can download an update and offer **Later** or **Restart and install**. macOS currently directs you to install the DMG manually, including in signed builds.

If **Test system notification** is not visible, check OS notification permissions and Do not disturb. System acceptance does not guarantee an on-screen banner. macOS system notifications require a signed app. Linux needs `libnotify.so.4` (`libnotify4` on Debian/Ubuntu) and a desktop notification service. If Settings reports unavailable screen-lock detection, check `gdbus` and the desktop ScreenSaver service; alerts wait until lock state can be verified.

## Privacy and network limits

Connections use **libp2p Noise** to encrypt traffic and authenticate device identities. Profile names are self-chosen and do not verify a person's identity. Local history, files, and settings are **not encrypted**; use trusted networks and disk encryption where needed.

Discovery depends on local mDNS, and direct traffic must be allowed by firewalls and Wi-Fi/VLAN rules. Lumilan has no internet relay to bypass network isolation. Voice calls need microphone access and direct local UDP traffic.

## Help Lumilan grow

Developed by [Iyan Sanjaya](https://iyansanjaya.com/). Found a problem? Use **Report a bug** in the app header or [open an issue](https://github.com/iyansanjaya/lumilan-chat/issues).

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

Contributions of any size help keep Lumilan improving. The **Support the App** icon offers Trakteer for Indonesia and Ko-fi for international supporters.
