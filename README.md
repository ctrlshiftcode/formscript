# FormScript

A Manifest V3 browser extension for Chrome and Brave.

## Project structure

```text
formscript/
|-- assets/
|   `-- icons/          # Extension icons
|-- src/
|   |-- background/     # Service worker and browser events
|   |-- content/        # Scripts injected into web pages
|   |-- consent/        # Save confirmation window
|   |-- options/        # Settings page
|   `-- popup/          # Toolbar popup
|-- manifest.json       # Extension metadata and configuration
`-- README.md
```

## Load for development

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Enable Developer mode.
3. Select **Load unpacked** and choose this project's root folder.

## Test the extension

Use the httpbin demo form: [https://httpbin.org/forms/post](https://httpbin.org/forms/post).

1. Open the page in a tab with FormScript installed and enabled.
2. Enter fictional values, such as `FormScript Test` and `test@example.com`. Do not use passwords, real data, or personal information.
3. Submit the form. A compact FormScript window should appear at the bottom right and ask to save the supported fields.
4. Select **OK**. The site will display the submission response.
5. Reopen [https://httpbin.org/forms/post](https://httpbin.org/forms/post). The FormScript icon should show the `1` badge.
6. Select the extension icon and choose **Fill form**. The saved values should appear; the form will not be submitted automatically.

If the test page is unavailable or changes its form, check `chrome://extensions` or `brave://extensions` to make sure the extension is enabled and has no errors.

## Features

- Submitting a form opens a compact window at the bottom right. The message appears in the window title, and the button row slides in from the right. **OK** saves the data; **Cancel** or `Esc` discards the capture.
- If a saved form is submitted again with different values, the window offers to update the record. `Esc` keeps the existing values. When **Ask before saving** is disabled, new values replace the previous ones automatically.
- The toolbar popup fills a saved form that matches the current site. Filling never submits the form.
- The browser context menu includes **Fill form with FormScript** on HTTP/HTTPS pages. Right-clicking a field targets its form; right-clicking elsewhere on the page searches for a saved form. Filling never submits the form.
- When the current page contains a matching saved form, the extension icon shows a `1` badge for that tab. The check runs when the page loads, when the tab becomes visible, and when forms are added dynamically.
- Settings and approved forms are stored in the browser profile's local storage (`chrome.storage.local`); they are not sent to a server.
- **Settings and backups** lets you download a JSON backup or restore a FormScript backup. Restoring replaces the existing FormScript forms and settings in this browser after confirmation.
- **Saved forms** lets you delete data for one site or remove all saved forms.
- Disabling **Ask before saving** automatically saves newly submitted forms.

## Privacy and limitations

- Passwords, usernames, one-time codes, payment-card data, and fields with credential or payment autocomplete are excluded from capture and filling.
- Capture listens for the page's standard `submit` event. Sites that submit forms without that event may not be detected.
- Form matching uses the site origin, action path, and field names/types. Forms that change dynamically may not match a saved record.
- Backups may contain personal form data. Store backup files securely.
- The browser grants the extension access to web pages so its content script can detect submissions and fill forms.
