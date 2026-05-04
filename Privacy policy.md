# Privacy Policy for Spigot Cookie Auto Detector

**Last updated:** May 4, 2026

Spigot Cookie Auto Detector is a Chrome extension that captures and displays cookie snapshots for `spigot.org` pages visited by the user.

---

## 1. Data We Collect

When enabled and in use, the extension may collect and store the following data locally in your browser:

- Page URL on `spigot.org` or its subdomains  
- Hostname / subdomain  
- Timestamp of snapshot  
- Cookie count  
- Cookie data returned by the Chrome Cookies API  
  - This may include cookie names, values, and attributes  

---

## 2. How We Use Data

The collected data is used solely to:

- Create a local snapshot of `spigot.org` cookie state  
- Display snapshot data in the extension popup  
- Allow the user to manually copy the snapshot as JSON  

---

## 3. Data Storage

All data is stored locally using:

- `chrome.storage.local`

No external databases or cloud storage are used.

---

## 4. Data Sharing and Selling

We **do not**:

- Sell your data  
- Rent your data  
- Transfer your data to third parties  
- Send extension-collected data to any remote servers  

All data remains on your device.

---

## 5. Remote Code

This extension does **not** load or execute any remote code.

All functionality is fully packaged within the extension.

---

## 6. Permissions Justification

The extension requests the following permissions:

- **`cookies`**  
  Used to read `spigot.org` cookies for snapshot creation  

- **`tabs`**  
  Used to detect the active tab and trigger snapshots  

- **`storage`**  
  Used to store snapshot data locally  

---

## 7. Your Choices

You have full control over your data:

- You can delete stored snapshots by clearing extension storage  
- You can stop all data collection by disabling or uninstalling the extension  

---

## Contact

If you have any questions about this Privacy Policy, please open an issue on this repository.
