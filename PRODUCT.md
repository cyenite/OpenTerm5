# Terminal5

## Register
Product. A desktop trading tool whose design serves account, market-data and order-management tasks.

## Users and purpose
Traders using MT5 accounts on Linux, macOS or Windows. Rebuild the familiar MT5 desktop workflow using a direct web connection without Wine, a VM or a Python bridge.

## Design intent
Preserve the existing MT5-style menu, Navigator, Market Watch, charts and Toolbox. Use compact tables, named controls and standard dialogs. Connection source, account identity and trading permissions must remain visible when switching accounts.

## Principles
Use actual broker data; identify unavailable data explicitly. Keep saved account metadata separate from passwords. Never replay uncertain orders automatically. Match the existing theme and keyboard conventions. Controls need accessible names, readable contrast and keyboard access.
