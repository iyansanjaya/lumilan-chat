# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

## 1.4.2

Changes from version 1.4.1.

### Added

- **Why a sticker was skipped.** After an import, **Settings → Sticker packs** lists each skipped file by name with the reason: an unsupported format, a file over 20 MB, too many pixels, still over 500 KB after shrinking to 256 px, a damaged file, a file that cannot be opened, or a full pack. The first 20 are listed and the rest are counted. Only file names are shown, never their folders.

### Changed

- **Settings is organized by category.** Profile, Appearance, Notifications, Lumi, Focus and breaks, Routine and tasks, Shelf, Sticker packs, Conversations, and App are listed on the left, and only the chosen category is shown, so you no longer scroll through one long page. The window keeps its size when you switch categories, and on a narrow window the categories become a row of tabs above the content. Arrow keys, Home, and End move between categories. **Manage stickers…**, **Turn off Lumi…**, and the other shortcuts into Settings open the right category directly.
- **Search sits on the conversation list.** The search box moved from the top bar to the sidebar, just above the **All / Direct / Rooms / Archive** tabs it works with. The top bar now holds only the app name and your account; it stays one row on a narrow window, and your name stays visible on medium-width windows too. Press **/** to jump to search from anywhere.
- **Fewer stickers are skipped:**
  - Animations longer than 120 frames are shortened instead of skipped: Lumilan keeps every second frame (or every third, and so on), and each kept frame lasts as long as the frames it replaces, so the animation plays at the same speed.
  - A busy animation is shrunk down to 256 px before it is skipped as too large, instead of stopping at 384 px.
  - Still images may be up to 100 million pixels (previously 40 million). Animations keep the 40 million pixel limit across all frames.
  - Images with minor format warnings that still open correctly are accepted; truncated or damaged files are still refused.

### Fixed

- **Incoming images and files are no longer easy to miss.** A file or image waiting for **Accept file** now moves its sender to the top of the contact list with a badge, as a new message does. Before, the sender moved up only after the file was accepted, and not at all if the request expired unanswered. The sender returns to the usual order once the request is answered here, in Lumi, or in a notification, or once it expires.
- Clicking a pack tab in the sticker picker no longer closes the picker, and keyboard focus stays on the tab you clicked.

### Build and validation

- New unit tests cover the reason given for each kind of skipped image, a 200-frame GIF shortened to 100 frames with the same total duration, and a full pack.
- New unit tests cover the contact list with waiting files: a waiting request raises its sender and counts in the badge, answering it from any surface or letting it expire lowers the sender again, and progress updates do not redraw the list.
- A new unit test checks that files dropped on **Settings → Shelf** and **Settings → Sticker packs** reach their own drop zones, while every other drop outside an open conversation is still refused. The sticker drop zone had no test before.
- The packaged UI smoke test now also checks, in light and dark themes at 1100, 375, and 320 px:
  - The Settings categories: keyboard navigation, a fixed window size, equal margins, the narrow tab row, and category labels that fit in all 8 languages.
  - The search box in the sidebar above the filter tabs, with a one-row top bar.
  - An image sent from a loopback device raising its sender with a badge until it is answered.
  - The sticker picker staying open on a real pointer click on a pack tab, the skip reason for a file that is not an image, and **Manage stickers…** opening its category.
- On Windows: 330 unit tests, packaging, package verification, the UI smoke test (3 runs), and the Lumi smoke test (3 runs) passed.

### Platform notes

- No new native dependency. Sticker images use the same image library bundled for Windows, macOS, and Linux, and the Settings, search, and contact list changes use no platform-specific code.
- When these notes were written, version 1.4.2 had been tested on Windows only. The macOS (Intel and Apple Silicon) and Linux (X11 and Wayland) packages had not yet been tested.
- The sticker network format is unchanged, so stickers sent from 1.4.2 still reach 1.4.1, and shortened animations arrive as ordinary stickers.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.4.1

Changes from version 1.4.0.

### Added

- **Sticker packs.** Import your own stickers in **Settings → Sticker packs**: enter a pack name, then choose or drop up to 100 PNG, JPEG, WebP, or animated GIF images (each up to 20 MB). Lumilan turns them into WebP stickers of at most 512 px and keeps them only on this device; your original files are not changed. Importing with an existing pack name adds to that pack, the same image is not stored twice, and unsupported images are skipped.
- **Sticker picker.** The sticker button next to the emoji button opens a picker with a **Recent** tab and one tab per pack. Click a sticker to send it right away, also as a reply. Arrow keys, Home/End, Enter, and Escape work as in the emoji picker; right-click a sticker or press Delete to remove it from this device.
- **Stickers arrive without Accept.** Stickers work in direct messages, Conversation Rooms, and Personal notes. The recipient does not need to choose **Accept** as for files: the receiving device takes only WebP images up to 500 KB and 512 px, decodes and re-encodes each one before storing it, and accepts at most 30 stickers per sender per minute.
- **Save a received sticker.** Select a sticker in a conversation and choose **Save sticker** to add it to the **Saved** pack.
- **Esc closes the open conversation.** As in WhatsApp or Telegram, Esc returns to the home view and keeps the draft for next time. Esc first closes whatever is on top: a dialog, the emoji picker, a menu, a message selection, or a reply in progress. On a narrow window it returns to the conversation list.

### Changed

- **Lumi sits flush with the macOS menu bar.** On every Mac display, not only Macs with a camera notch, Lumi now hangs from the top edge of the screen over the middle of the menu bar, and the idle pill is as tall as the menu bar. Without a visible menu bar, and on Windows and Linux, the pill stays 30 pt tall. Its bottom corners now match the curved shoulders.
- Notifications and Lumi show **Sticker** for a received sticker, or **New message received** when message previews are off. Replies, copied messages, reminders, and the unread inbox also show **Sticker** instead of a file name.
- Stickers are not counted or listed as shared files in the conversation details.

### Build and validation

- The sticker library and sticker images have their own Electron-free modules, with tests for import limits, duplicates, damaged saved data, recovery after an interrupted import, deleting packs and stickers, and saving from a conversation.
- Network tests with loopback devices cover stickers in direct messages and Rooms, Room members on older versions, Personal notes, the Announcement Room, invalid and oversized images, repeated packets, the per-sender limit, outdated Room versions, and removing a sticker's file with its message.
- The packaged UI smoke test imports a pack, sends from the picker in Personal notes and to a loopback contact, receives an animated sticker without a consent step, checks the still frame under reduced motion, saves a received sticker, and deletes packs, in light and dark themes at 1100, 375, and 320 px. It also checks the new Esc behavior.
- The drop zones in **Settings → Shelf** and **Settings → Sticker packs** share one implementation.

### Platform notes

- Stickers use the image library already bundled for Windows, macOS, and Linux; no new native dependency was added.
- Stickers pass the packaged smoke tests on Windows. When these notes were written, the macOS (Intel and Apple Silicon) and Linux (X11 and Wayland) packages had not yet been tested with stickers.
- Lumi's position on a Mac relies on the menu bar height, because Electron does not report the camera notch. With an auto-hiding menu bar, the 120 pt idle pill can sit inside the notch.
- Older Lumilan Chat versions show no sticker button and do not receive stickers. If they open history that contains stickers, each one appears as a `sticker.webp` file.
- Current packages are unsigned. Windows or macOS may display a publisher warning; macOS system notifications require a signed application. Download packages from the [official Releases page](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.4.0

Changes from version 1.3.0.

### Added

- **Work breaks.** Choose how long to work and rest on Lumi's **Breaks** page or in **Settings → Work breaks** (off by default). When time is up, Lumi reminds you, then every display dims with a countdown and **Back to work**. Snooze, skip, or end a break early; breaks wait during Do not disturb, focus sessions, calls, screen lock, and sleep.
- **Open Lumi on hover.** Choose **Settings → Lumi → Open Lumi panel → On hover** to open the panel by resting the pointer on the pill.

### Changed

- **Lumi has its own Settings section.** Showing Lumi, keeping it visible while you use the window, and how the panel opens are now in **Settings → Lumi**.
- **A softer Lumi.** A rounder body, bigger eyes with highlights, pink cheeks, and golden feet. Animations and poses are unchanged.
- **Lumi is easier to discover.** Hovering the pill shows an **Open** hint and previews the newest card, a one-time introduction appears the first time, and the **Focus** page has a **Turn on** button.
- **Lumi's gold across the app.** Buttons, the selected conversation, mentions, progress bars, switches, and tabs use Lumi's gold, and dropdowns share one style everywhere.
- **One network status.** The bottom of the sidebar shows **Encrypted local network** once another device is online and **Looking for devices…** until then.

### Fixed

- Double-clicking a tab or button no longer selects its label.
- Long dropdown options no longer run under the arrow.
- Lumi's panel no longer gets cut off at the sides while it springs open.

### Build and validation

- Receiving files moved into its own tested module; the full 5 GB transfer test still passes. Behavior is unchanged.
- Break rules and the break screen have their own tested modules, and calls from the window to the app's core are now type-checked.

### Platform notes

- On Linux Wayland, the break screen is one solid dark window on one display and Lumi uses system notifications; Work breaks are in **Settings**. Games in exclusive fullscreen can stay above the break screen.
- Not checked on physical devices: breaks across real lock and sleep, macOS fullscreen Spaces, and Windows displays with different scaling.
- On macOS, download and install updates from the Releases page; the app tells you when a new version is available.
- Packages are unsigned; Windows or macOS may display a publisher warning. macOS system notifications require a signed app.

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
