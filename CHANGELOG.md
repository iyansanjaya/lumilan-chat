# Changelog

[Bahasa Indonesia](CHANGELOG.id.md)

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
