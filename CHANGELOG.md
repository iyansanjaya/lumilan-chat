# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

## 1.3.0

Changes from version 1.2.2.

### Added

- **Link previews for YouTube, Shorts, and Instagram.** A link in a message now shows a static card with the title, the channel or account, a small thumbnail, and an **Open in browser** button. The card appears in the composer before you send and in the conversation on both sides. There is no embedded player or third-party script.
- **Link cards for Facebook, Threads, and X.** These links get a card made on your device from the address alone, without contacting the platform.
- **Lumi opens into pages.** Clicking the pill opens **Activity**, **Focus**, **Routine**, **Tasks**, and **Shelf** pages in a panel that widens beside the notch, with page tabs, Left/Right keys, and horizontal swipes; moving and hiding Lumi sit in the bar and its **⋯** menu. The idle pill now shows Lumi's eyes, the time, and a count of queued activity.
- **Water routine.** Log a drink from Lumi or **Settings → Routine**, see today's intake against your goal with an hourly chart, and turn on reminders for your active hours. Reminders wait during Do not disturb, lock, and sleep, appear once afterwards, and stop when the goal is reached.
- **Tasks.** Add, tick, and remove tasks from Lumi or **Settings → Tasks**. A due time set in Settings creates a local reminder that is canceled when the task is done or removed.
- **File shelf.** Drop up to 10 files on Lumi or in **Settings → Shelf** to keep them close. Open them, drag them out into another app, send them to an online contact with the usual consent and verification, or save them to Personal notes. The shelf keeps only where each file is and never deletes a file.
- **Device notices.** Lumi briefly shows when the charger is connected or removed (with the battery level where available), when the network drops or returns, and when Lumilan devices come online.
- **Focus sessions.** Start a 25, 45, or 60-minute session from Lumi's Focus page or **Settings → Focus** (off by default). Your status becomes Do not disturb for connected contacts and returns to the previous one at the end. Lumi's idle pill shows the remaining minutes, its panel has a countdown with Pause/Resume and Done, and one summary of unread messages and conversations appears when the session finishes, without names, text, or marking anything read. Sessions survive restart, lock, and sleep.
- **Fetching is opt-in.** The first YouTube or Instagram link asks whether to fetch the title and image from that host: choose **Turn on** or **No thanks**, and change it later in **Settings → Link previews**. Only the sending device contacts YouTube or Instagram; recipients receive the card over the LAN and never go online. Instagram previews work only while Instagram serves post details without login, and otherwise fall back to a link card.

### Changed

- Links in messages can now be opened, through the card's **Open in browser** button only. The address is checked again before the default browser opens it.
- **Lumi's pill stays on screen.** By default the pill remains while you use the main window; arrivals over a watched window only raise its count. **Settings → Notifications → Lumi pill while you use the window** (or the tray) restores the earlier behavior. A panel you open yourself now stays while the pointer is on it and closes shortly after the pointer leaves; typing in it keeps it open until you click elsewhere or press Escape.
- **Lumi is now a Dynamic Island.** The companion is a black pill hanging from the top of the screen, joined to the edge by curved shoulders like a hardware notch. It morphs smoothly into the compact preview and the detail panel instead of resizing its window, and clicks outside the island reach the windows below it. On a Mac with a camera notch, the idle pill covers the notch and the panel opens above the menu bar; other displays keep it below the menu bar. Animations still stop while Lumi is hidden and follow reduced motion.

### Fixed

- When a copy of Lumilan Chat cannot update itself (an unpacked folder, or an AppImage run outside AppImage), **Check for updates** now says so and points to the release page instead of asking you to try again later.

### Build and validation

- Added tests for link detection and canonical addresses, lookalike hosts, refused redirects, size and time limits, Open Graph parsing, thumbnail re-encoding, validation of received cards (a card must describe the first link in the message), cards bound to their conversation, and the composer flow. A three-device loopback test checks that receivers decode thumbnails again, limit them per sender, and delete them with their messages.
- The packaged smoke test now covers Ask first, Turn on and No thanks, Shorts and Instagram cards from an in-process fixture without internet access, local Threads, X and Facebook cards, received cards, Open in browser, thumbnails kept in place while new messages arrive, and light/dark narrow layouts.
- Lumi tests cover the fixed window, click-through beside the expanded panel, the Linux X11 window shape, and macOS notch placement. The packaged smoke test waits for the morph to settle, then checks the idle pill, the compact size, unclipped panel content, and that the native window never resizes.
- Focus sessions have their own Electron-free module with tests for start, pause, early end, restart, storage failure, status restore, the summary count, and both lock/sleep orders. The packaged smoke tests start a session from Lumi's button over a real LAN connection, check the idle pill, end it during lock and sleep, and check the Settings controls in light/dark narrow windows.
- Water reminders, tasks, and the shelf have Electron-free modules with tests for damaged saved data, reminder timing across days and midnight, restart, missed slots, storage failures, the reminder link, shelf limits, paths kept out of every view, progress, and cancellation. Lumi tests cover the always-on pill, badge-only arrivals over a watched window, the pointer-leave close and typing hold, device notices, and validated page and drop actions. The packaged smoke tests check the deck, the pill clock and blink, a water reminder after a resume, tasks while typing, and real files dropped on the shelf with open, native drag-out, a consented send, cancellation, and saving to notes. File uploads from conversations and from the shelf share one code path with the same 8-transfer limit.
- Notification, attention and settings rules moved out of the main process entry into their own modules, tested without Electron. New tests cover lock → suspend → resume → unlock and the reverse order: deferred messages and reminders appear once, only if still unread or pending. Behavior is unchanged.

### Platform notes

- **Open in browser** uses the default browser on Windows, macOS, and Linux (`xdg-open`). Lookups use Chromium's network stack and follow the operating system's proxy settings.
- Lumi uses the desktop overlay on Windows, macOS, and Linux X11. Linux X11 limits the window's input and drawing region to the island. macOS notch placement relies on the menu bar height because Electron does not report the notch; with an auto-hiding menu bar the island stays below the notch. Behavior over a physical notch, beside menu bar items, and over fullscreen Spaces still needs a check on a notched Mac. Linux Wayland uses system notifications.
- Routine, Tasks, and Shelf have a home in **Settings** on every system, including where Lumi is off or Linux Wayland uses system notifications. The pages, the always-on pill, and the shelf are verified on Windows with a simulated file drop; a real drag from Explorer onto the idle pill still needs a manual check. On macOS the idle pill passes clicks through and may not receive a dragged file, so drop onto the open panel or use **Settings → Shelf**. They pass the packaged smoke tests on Windows and on GitHub-hosted macOS (Intel and Apple Silicon) and Linux X11 runners; physical Macs and Linux desktops still need a check. Electron cannot tell when another app is full screen, so the pill stays above full-screen apps; use **Hide for 30 minutes** or the "only when you are not looking" setting.
- Focus sessions can be started from **Settings → Focus** on every system, including where Lumi is off or Linux Wayland uses system notifications. They pass the packaged smoke tests on Windows and on GitHub-hosted macOS and Linux runners, with lock and sleep simulated; physical devices still need a check.
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
