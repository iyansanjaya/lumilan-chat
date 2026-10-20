# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

## 1.3.0

Changes from version 1.2.2.

### Added

- **Link previews for YouTube, Shorts, and Instagram.** A link in a message now shows a static card with the title, the channel or account, a small thumbnail, and an **Open in browser** button. The card appears in the composer before you send and in the conversation on both sides. There is no embedded player or third-party script.
- **Link cards for Facebook, Threads, and X.** These links get a card made on your device from the address alone, without contacting the platform.
- **Fetching is opt-in.** The first YouTube or Instagram link asks whether to fetch the title and image from that host: choose **Turn on** or **No thanks**, and change it later in **Settings → Link previews**. Only the sending device contacts YouTube or Instagram; recipients receive the card over the LAN and never go online. Instagram previews work only while Instagram serves post details without login, and otherwise fall back to a link card.

### Changed

- Links in messages can now be opened, through the card's **Open in browser** button only. The address is checked again before the default browser opens it.

### Build and validation

- Added tests for link detection and canonical addresses, lookalike hosts, refused redirects, size and time limits, Open Graph parsing, thumbnail re-encoding, validation of received cards (a card must describe the first link in the message), cards bound to their conversation, and the composer flow. A three-device loopback test checks that receivers decode thumbnails again, limit them per sender, and delete them with their messages.
- The packaged smoke test now covers Ask first, Turn on and No thanks, Shorts and Instagram cards from an in-process fixture without internet access, local Threads, X and Facebook cards, received cards, Open in browser, thumbnails kept in place while new messages arrive, and light/dark narrow layouts.

### Platform notes

- **Open in browser** uses the default browser on Windows, macOS, and Linux (`xdg-open`). Lookups use Chromium's network stack and follow the operating system's proxy settings.
- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux Wayland uses system notifications.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.2.2

Changes from version 1.2.1.

### Added

- **Notifications follow whether you are actually looking at Lumilan.** Lumi (or the system notification where Lumi is unavailable) now appears whenever the main window is not being watched: when it is minimized, closed to the tray, behind another window, or focused but untouched for 3 minutes. Previously, a window that stayed open behind other windows showed no Lumi, and a focused window left unattended marked new messages in the open conversation as read without any notification.
- **Messages that arrive while you are away stay unread.** In an unattended window, new messages are marked read only after you return: switch back to the window, or click, type, scroll, or touch it. Moving the pointer alone does not count. If the operating system does not report input idle time, only window focus is used.
- **Persistent cues on Windows and macOS.** On Windows, the taskbar button flashes until you return to the window and shows a red overlay while messages are unread. On macOS, the Dock icon bounces once. The flash and bounce follow the same notification, mute, Do not disturb, and screen lock rules as Lumi; like the window title, the overlay reflects the unread count. Linux relies on Lumi and system notifications, because some desktops turn a taskbar alert into a second notification.

### Fixed

- **The conversation no longer jumps while a file arrives.** On the receiving device, every progress step rebuilt the whole message list and reloaded image previews, so the conversation jumped up and down until the file finished. Progress now updates in place, shown thumbnails are kept, and a file arriving in another conversation no longer redraws the one you have open.

### Changed

- Over a main window that is only behind other windows, Lumi shows arrivals without taking focus and leaves no idle strip; the strip still appears while the main window is minimized or closed to the tray. Lumi's renderer now starts the first time the main window is not being watched.
- When Lumi fails while a call or file request is waiting, the request is also handed to a main window that is open but not being watched, instead of being left there unseen.

### Build and validation

- The package verifier now follows the packaged main entry, page scripts, and preloads through their imports. Every module the app can load must be in the package, and every packaged compiled file must match the build output byte for byte, so a new runtime module only needs its `build.files` entry.
- Added tests for attention detection (including invalid idle sources and the 3-minute boundary), Lumi over a window behind other windows, read marking after a confirmed return, the preload presence bridge, receiving progress without rebuilding the conversation, and the derived package verification.
- The packaged smoke tests now cover Lumi behind another window without focus theft, unread arrivals in an unattended window, taskbar and Dock cues, and receiving a 24 MB file without layout shift or reloaded thumbnails. They control idle time explicitly and re-establish window focus before reading steps, so an unattended desktop or CI display no longer changes the result.

### Platform notes

- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux Wayland uses system notifications. Where the operating system does not report input idle time, which may include some Wayland desktops, a focused window counts as watched.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.2.1

Changes from version 1.2.0.

### Fixed

- **A Lumi failure no longer interrupts you.** If the Lumi overlay crashes or fails to load while a call or file request is waiting, the main window no longer opens and takes focus during Do not disturb, on a locked screen, during suspend, while Lumi is hidden for 30 minutes, or with notifications turned off. The newest waiting request (calls before files) is handed to the main window once, at the first moment Lumi would be allowed to interrupt, and its conversation opens so you can accept or decline it there. If the main window is already open, it is not shown again. A single failed load is also no longer handled twice.
- **Conversation filters fit narrow windows.** The All, Direct, Rooms, and Archive filters in the sidebar now sit in two rows with comfortable padding, so labels no longer touch the button edges when the window is narrowed. In the narrow single-panel layout they stay in one row when they fit. Long translations are shortened with an ellipsis instead of overflowing.

### Changed

- Added a **proprietary license** in English and Indonesian ([LICENSE](LICENSE), [LICENSE.id.md](LICENSE.id.md)). Official builds remain free to use; copying, modifying, redistributing, or reverse engineering Lumilan Chat requires written permission. Source code in the public repository is shared for reference only. Third-party components keep their own licenses.
- Reorganized the source code into `src/` and `tests/` folders. Release packages contain the same files apart from internal paths.
- Text files now use LF line endings on every operating system.

### Build and validation

- Added tests for Lumi's failure handoff under every block (Do not disturb, lock and suspend in both orders, Lumi hidden, notifications off) and for answered, muted, and expired requests, plus a regression test that each file decision is used only once across the main window, Lumi, and request expiry.
- The packaged Lumi smoke test now crashes the real Lumi renderer while the screen is locked. The renderer process is ended the same way on Windows, macOS, and Linux.
- When the Linux smoke test fails in CI, it now names the failing step and line and labels each log.

### Platform notes

- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux Wayland uses system notifications.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.2.0

Changes from version 1.1.0.

### Added

- **Unread conversations first.** Connected contacts with unread private messages now appear above contacts whose messages have been read. Each group keeps alphabetical name order in the selected language. Once you read a conversation in the active app window, its contact returns to the normal order. Lumi previews do not mark messages as read.

### Changed

- Migrated the application, preload modules, tests, and Node scripts to **strict TypeScript**, with shared communication contracts and separate type checks for the desktop, renderer, and preload environments.
- Updated the build and packaging process to use freshly compiled application files and copied runtime assets. Application source TypeScript, development scripts, tests, and source maps are excluded from release packages.

### Build and validation

- Updated package verification for the compiled layout, including required interface assets, runtime modules, standalone sandboxed preloads, and the macOS application icon.
- Expanded automated validation across **Windows x64, macOS Intel and Apple Silicon, and Linux x64**, including X11 and Wayland. The build workflow repeats type checks, automated tests, full 5 GB transfer tests, and packaged application smoke tests three times.
- Added regression checks for unread ordering, reading a conversation, duplicate contact names, reconnections, search and archive filters, and supported interface languages.
- Improved Linux test setup with CJK fallback fonts and isolated Wayland input for interface and notification fallback checks.

### Platform notes

- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux Wayland uses system notifications.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).
