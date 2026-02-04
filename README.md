# Focusmunk

A Chrome extension that blocks distracting websites during scheduled focus periods. Configuration is stored on a remote server to prevent tampering.

## Features

- **Scheduled blocking**: Set focus times by day of week and time range
- **URL whitelist**: Allow specific sites using regex patterns
- **YouTube filtering**: Block videos except those with allowed keywords in the title
- **Tamper-proof**: Settings stored on server, protected by password
- **Temporary disable**: Unlock browsing for a set period (requires password)

## Project Structure

```
focusmunk/
├── server/           # Flask backend
│   ├── app.py        # Server application
│   └── requirements.txt
└── extension/        # Chrome extension
    ├── manifest.json
    ├── icons/
    ├── pages/
    │   ├── popup.html
    │   ├── setup.html
    │   ├── settings.html
    │   ├── blocked.html
    │   └── checking.html
    ├── scripts/
    │   ├── background.js
    │   ├── popup.js
    │   ├── setup.js
    │   └── settings.js
    └── styles/
        └── shared.css
```

## Setup

### 1. Start the Server

```bash
cd server
pip install -r requirements.txt

# Set environment variables (optional)
export SETUP_CODE="your-secret-setup-code"
export DATABASE_URL="sqlite:///focusmunk.db"

# Run the server
python app.py
```

The server runs on `http://localhost:5000` by default.

### 2. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder

### 3. Configure Focusmunk

1. Click the Focusmunk icon in your browser toolbar
2. Click "Set Up"
3. Choose "Create New Configuration"
4. Enter the server URL (e.g., `http://localhost:5000` or your production URL)
5. Enter the setup code (default: `focusmunk-setup-2024`)
6. Set your password, whitelist, schedule, and YouTube keywords
7. Save the configuration ID somewhere safe!

The server URL is stored in the extension and used for all API calls. You can point different extension installs at different servers if needed.

## Server API

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | /config | Setup code | Create new config |
| GET | /config/:id | None | Fetch config |
| PUT | /config/:id | Password | Update config |
| POST | /config/:id/verify | None | Verify password |
| POST | /config/:id/change-password | Password | Change password |
| POST | /config/:id/temporary-disable | Password | Disable blocking |
| POST | /config/:id/cancel-disable | Password | Cancel disable |
| POST | /setup-code/verify | None | Verify setup code |

## Configuration

### Environment Variables

- `SETUP_CODE`: Required to create new configurations (default: `focusmunk-setup-2024`)
- `DATABASE_URL`: Database connection string (default: `sqlite:///focusmunk.db`)

### Whitelist Patterns

Use JavaScript regex patterns. Examples:
- `^https://docs\\.google\\.com/.*$` - Allow Google Docs
- `^https://github\\.com/.*$` - Allow GitHub
- `^https://.*\\.edu/.*$` - Allow .edu domains

### YouTube Keywords

Videos with these words in the title are allowed during focus time:
- `tutorial`
- `lecture`
- `course`
- `documentary`

## Security Notes

- Passwords are hashed with bcrypt
- The setup code prevents unauthorized configuration creation
- If storage is cleared, the user cannot reconfigure without knowing the setup code or config ID
- The accountability partner should keep both the setup code and config ID secure

## Production Deployment

For production use:

1. Deploy the server to a hosting service (Heroku, Railway, etc.)
2. Use a proper database (PostgreSQL)
3. Set a strong `SETUP_CODE`
4. Update `API_URL` in the extension's JavaScript files
5. Consider force-installing the extension via enterprise policy for maximum security
