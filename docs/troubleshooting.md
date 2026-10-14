# Troubleshooting

Start with **Toolbox → Journal**. It records connection events, logins and the broker's answer to every
order. Right-click it and choose **Copy All** to include it in a bug report, after removing anything
personal.

## Installation and start-up

### Electron will not start on Linux (sandbox error)

On Ubuntu 24.04 and later, AppArmor restricts unprivileged user namespaces. When you run from source,
Electron may then stop with:

```
The SUID sandbox helper binary was found, but is not configured correctly.
```

Packaged builds (AppImage and `.deb`) are not affected. For development, allow the Electron binary in
your checkout to use user namespaces with an AppArmor profile, replacing the path with your own:

```bash
printf 'abi <abi/4.0>,\ninclude <tunables/global>\nprofile openterm-electron %s flags=(unconfined) {\n  userns,\n}\n' "$PWD/node_modules/electron/dist/electron" | sudo tee /etc/apparmor.d/openterm-electron
sudo apparmor_parser -r /etc/apparmor.d/openterm-electron
```

Do not disable the sandbox with `--no-sandbox` for everyday use.

### macOS says the app is damaged or from an unidentified developer

Release builds are not yet signed. Right-click OpenTerm in Applications, choose **Open**, and confirm.

### Windows SmartScreen blocks the installer

Choose **More info → Run anyway**. Builds are not yet code-signed.

## Logging in

### My server is not in the list

The list comes from MetaQuotes' public directory and is refreshed weekly. Type the full server name
exactly as your broker gives it and press Enter. If the server still cannot be found, enter your
broker's MT5 web trading address under **Advanced**. See
[Accounts and brokers](user-guide/accounts-and-brokers.md#entering-the-address-yourself).

### "Could not find the address of …"

OpenTerm could not find a web trading address for the server. Ask your broker for its MT5 web terminal
address (often labelled "WebTrader") and enter it under **Advanced**. Please also send us a
[broker compatibility report](https://github.com/cyenite/OpenTerm5/issues/new?template=broker_report.yml)
so other users get it automatically.

### Login fails with an authentication error

- Check the login, password and server. Investor (read-only) passwords can log in but cannot trade.
- Accounts with two-factor authentication need a fresh one-time code.
- After many attempts in a short time, brokers can refuse logins for a few minutes. Wait, then try once.

### Logging in elsewhere disconnects OpenTerm

A broker allows one web session per login. Logging in to the same account from another web terminal,
or from a second copy of OpenTerm, can end the existing session. Use one session per account.

### "Save password securely" is greyed out

No secure keychain is available. On Linux, install and unlock GNOME Keyring or KWallet, then restart
OpenTerm. OpenTerm never falls back to storing passwords in plain text.

### Saved passwords stopped working after upgrading from Terminal5

Saved passwords are encrypted with a key tied to the application's name in your keychain. After the
rename to OpenTerm, enter each password once more and tick **Save password securely**.

## Trading

### An order was rejected

The Journal shows the broker's return code and message. Common causes:

| Message | Meaning |
|---|---|
| Invalid stops | The stop loss or take profit is too close to the price, or on the wrong side |
| Invalid volume | The volume is below the minimum, above the maximum, or not a multiple of the step |
| Market closed | The symbol is not trading now |
| No money | Not enough free margin |
| Requote, off quotes | The price moved; try again |
| Trade disabled | Trading is disabled for the account or the symbol (for example an investor login) |

### "Outcome unknown" after a disconnection

The connection dropped before the broker confirmed the order. OpenTerm never sends the order again on
its own. Check **Toolbox → Trade** and **History** after reconnecting to see whether it was filled.

### Margin and free margin show no value

Margin is not yet calculated by OpenTerm, so these values are shown as unavailable rather than as a
wrong figure. Balance, equity and profit are live. See the [roadmap](roadmap.md).

### Automation, copying or signals did nothing

These engines run inside OpenTerm. Check that:

- OpenTerm is running and connected to every account involved, with saved passwords;
- the copier, follower or signal source is **Enabled** and not in dry-run mode;
- no equity guard has tripped (Automation workspace);
- the signal server is enabled and not paused (Signals workspace).
