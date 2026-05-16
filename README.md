# Eurovision Party Scoreboard

A live Eurovision-style party scoreboard for collecting juror rankings, revealing points, and keeping a real-time tally.

## Requirements

- Node.js 20 or newer
- Everyone using the locally hosted mode must be on the same local network as the host computer.

## Install Node.js

If `npm start` does not work, install Node.js first.

### Windows

Option 1: Download the LTS installer from:

```text
https://nodejs.org/
```

Run the installer, accept the defaults, then close and reopen PowerShell.

Option 2: If you use `winget`, open PowerShell and run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Check that Node and npm are installed:

```powershell
node --version
npm --version
```

### macOS

Option 1: Download the LTS installer from:

```text
https://nodejs.org/
```

Run the installer, then close and reopen Terminal.

Option 2: If you use Homebrew, run:

```bash
brew install node
```

Check that Node and npm are installed:

```bash
node --version
npm --version
```

## Run Locally

From this project folder:

```powershell
npm start
```

The host can open:

```text
http://localhost:4173
```

The app stores party data in `data/parties/`. That folder is ignored by git.

## Host A Local Watch Party

1. Start the app on the host computer with `npm start`.
2. Open `http://localhost:4173` on the host computer.
3. Go to `Host` and claim host access.
4. Go to `Settings`.
5. Share the invite link shown there with guests.

Settings also shows a QR code for the selected invite link. Guests can scan it with their phone camera instead of typing the address.

If the app is opened on `localhost`, the Settings invite field tries to show a local-network IP link such as:

```text
http://192.168.1.23:4173/?party=local
```

Guests on other devices cannot use `localhost`, because `localhost` means "this same device." They need the host computer's local IP address.

Some computers have multiple network adapters, so the app may find more than one possible local address. The address for your active Wi-Fi or Ethernet network is usually the one that starts with `192.168.x.x`, `10.x.x.x`, or `172.16.x.x` through `172.31.x.x`. If one link does not work, try the other local addresses.

## Find Your Local IP Address

### Windows

Open PowerShell and run:

```powershell
ipconfig
```

Look for the active Wi-Fi or Ethernet adapter and copy the `IPv4 Address`, for example:

```text
192.168.1.23
```

Then guests should visit:

```text
http://192.168.1.23:4173/?party=local
```

### macOS

Open Terminal and run:

```bash
ipconfig getifaddr en0
```

If that prints nothing and you are using Ethernet, try:

```bash
ipconfig getifaddr en1
```

You can also find it in `System Settings -> Network -> Wi-Fi` or `Ethernet`.

Then guests should visit:

```text
http://YOUR-IP:4173/?party=local
```

## Network Caveats

- Guests must be on the same Wi-Fi or wired network as the host computer.
- Some guest networks block devices from talking to each other. If guests cannot connect, try a non-guest Wi-Fi network or a hotspot.
- The host computer's firewall may ask whether Node.js can accept incoming connections. Allow it for the local/private network.
- VPNs can interfere with local connections. Turning off the VPN may help.
- The host computer must stay awake and keep the terminal running while guests vote.

## Parties And Entries

The default local party is:

```text
local
```

You can create additional parties in `Settings`. Each party has its own:

- entries
- submitted ballots
- scoreboard totals
- host lock state

The starter lineup is in:

```text
entries/2026.tsv
```

That file is only a template for new parties. After a party edits entries in Settings, those entries are saved with that specific party.

## Host Locking

Host controls are locked so guests cannot reveal points or reset the scoreboard.

The host can:

- claim host access on the host device
- set a host password
- unlock host controls from another browser by entering that password

Guest devices can submit and edit their own ballot until the host starts presenting that ballot.

## Public Hosting Notes

The app has party IDs and host locking so it can be deployed publicly later. For a real public deployment, use HTTPS and persistent storage/backups. The current version uses local JSON files, which is fine for local hosting and simple demos but not ideal as the only storage for a production public service.
