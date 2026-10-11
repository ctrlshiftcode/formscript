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
3. Submit the form. A compact FormScript window should appear at the bottom right with **OK** and **Cancel** buttons and a countdown to their right.
4. Select **OK** to save the supported fields. **Cancel**, `Esc`, closing the window, or waiting ten seconds cancels the capture. The site will display the submission response.
5. Reopen [https://httpbin.org/forms/post](https://httpbin.org/forms/post). The FormScript icon should show the `1` badge.
6. Select the extension icon and choose **Fill form**. The saved values should appear; the form will not be submitted automatically.

As another option, use the [Selenium Web Form](https://www.selenium.dev/selenium/web/web-form.html). Enter fictional values in **Text input** and **Textarea**, submit the form, and select **OK** in the FormScript window. The password field is intentionally excluded. Return to the form page to test the green **F** button.

If the test page is unavailable or changes its form, check `chrome://extensions` or `brave://extensions` to make sure the extension is enabled and has no errors.

## Features

- Submitting a form opens a compact window at the bottom right. Its title describes the save action, and a 10-second countdown appears to the right of the buttons. **OK** saves; **Cancel**, `Esc`, closing the window, or letting the timer expire cancels the capture.
- If a saved form is submitted again with different values, the window offers to update the record. Canceling keeps the existing values. When **Ask before saving** is disabled, new values replace the previous ones automatically.
- A small square green **F** button appears inside the first eligible text field of each saved form, aligned to the right with 5px of inset. It scales to fit the field and is hidden if the field is too small. Clicking it fills that form directly. The toolbar popup and browser context-menu fill actions remain available; filling never submits the form.
- The browser context menu has a **FormScript** submenu on HTTP/HTTPS pages. **Fill form** targets the form under a right-clicked field, or searches the page when opened elsewhere. **Clear saved form data for this site** removes saved forms for the current origin. The **Fill data test** submenu is organized into functional groups with separators: **Name**, **Email**, **Cell phone (formated)**, **Cell phone (unformated)**, **Landline (formated)**, **Landline (unformated)**, **CPF (formated)**, **CPF (unformated)**, **RG (formated)**, **RG (unformated)**, **Company name**, **CNPJ (formated)**, **CNPJ (unformated)**, **Address**, **CEP (formated)**, and **CEP (unformated)**. Each option inserts generated test data into the right-clicked text field, or copies it to the clipboard if clicked elsewhere. Filling never submits the form.
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
