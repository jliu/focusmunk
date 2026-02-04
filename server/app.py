"""
focusmunk Server - Flask backend for configuration storage

This server stores user configurations (free time budgets, whitelists, YouTube filters).
The browser extension fetches config from here and does all URL blocking locally.
"""

import os
import secrets
import string
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, request
from flask_cors import CORS
import bcrypt
from flask_sqlalchemy import SQLAlchemy

# Initialize Flask app with CORS (allows browser extension to make requests)
app = Flask(__name__)
CORS(app)

# Database location (defaults to SQLite file, can override with DATABASE_URL env var)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///focusmunk.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Setup code required to create new configurations (can override with SETUP_CODE env var)
SETUP_CODE = os.environ.get('SETUP_CODE', 'focusmunk-setup-2024')

db = SQLAlchemy(app)


# =============================================================================
# Database Model
# =============================================================================

class Config(db.Model):
    """
    Stores a user's focusmunk configuration.
    Each config has a unique ID like "ABCD-1234" that users can share across devices.
    """
    id = db.Column(db.String(9), primary_key=True)
    password_hash = db.Column(db.String(128), nullable=False)
    whitelist = db.Column(db.JSON, default=list)          # URL patterns to allow
    youtube_keywords = db.Column(db.JSON, default=list)   # Allowed video title keywords
    youtube_creators = db.Column(db.JSON, default=list)   # Allowed YouTube channels
    disabled_until = db.Column(db.DateTime, nullable=True) # Temporary disable expiration
    
    # Budget mode free time tracking
    daily_free_seconds = db.Column(db.JSON, default=lambda: {
        'mon': 0, 'tue': 0, 'wed': 0, 'thu': 0, 'fri': 0, 'sat': 0, 'sun': 0
    })
    free_time_used_today = db.Column(db.Integer, default=0)  # Seconds used today
    free_time_date = db.Column(db.String(10), nullable=True)  # Date string e.g. '2025-02-03'
    free_time_started_at = db.Column(db.DateTime, nullable=True)  # When current session started
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def get_todays_allowance(self):
        """Get the free time allowance for today in seconds"""
        days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
        day = days[datetime.utcnow().weekday()]
        return (self.daily_free_seconds or {}).get(day, 0)

    def process_free_time(self):
        """
        Process free time tracking on each request:
        - Reset if new day
        - Accumulate time if in active session
        - Auto-end session if budget exhausted
        Returns remaining seconds for today.
        """
        now = datetime.utcnow()
        today = str(now.date())
        
        # Reset if new day
        if self.free_time_date != today:
            self.free_time_used_today = 0
            self.free_time_date = today
            # If session was active across midnight, restart it from now
            if self.free_time_started_at:
                self.free_time_started_at = now
        
        # If in active session, accumulate time since last sync
        if self.free_time_started_at:
            elapsed_seconds = int((now - self.free_time_started_at).total_seconds())
            self.free_time_used_today += elapsed_seconds
            self.free_time_started_at = now
            
            # Auto-end if budget exhausted
            todays_allowance = self.get_todays_allowance()
            if self.free_time_used_today >= todays_allowance:
                self.free_time_used_today = todays_allowance  # Cap it
                self.free_time_started_at = None  # End session
        
        return self.get_todays_allowance() - self.free_time_used_today

    def to_dict(self):
        """Convert to JSON-serializable dict for API responses (excludes password)"""
        remaining = self.process_free_time()
        db.session.commit()  # Save any changes from process_free_time
        
        return {
            'id': self.id,
            'whitelist': self.whitelist or [],
            'youtubeKeywords': self.youtube_keywords or [],
            'youtubeCreators': self.youtube_creators or [],
            'disabledUntil': (self.disabled_until.isoformat() + 'Z') if self.disabled_until else None,
            'dailyFreeSeconds': self.daily_free_seconds or {
                'mon': 0, 'tue': 0, 'wed': 0, 'thu': 0, 'fri': 0, 'sat': 0, 'sun': 0
            },
            'freeTimeUsedToday': self.free_time_used_today or 0,
            'freeTimeStartedAt': (self.free_time_started_at.isoformat() + 'Z') if self.free_time_started_at else None,
            'freeTimeRemaining': max(0, remaining),
            'todaysAllowance': self.get_todays_allowance(),
        }


# =============================================================================
# Helper Functions
# =============================================================================

def generate_config_id():
    """Generate a random config ID like 'WXYZ-1234' (4 letters + 4 numbers)"""
    letters = ''.join(secrets.choice(string.ascii_uppercase) for _ in range(4))
    numbers = ''.join(secrets.choice(string.digits) for _ in range(4))
    return f"{letters}-{numbers}"


def hash_password(password):
    """Hash a password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password, password_hash):
    """Verify a password against its bcrypt hash"""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def require_password(f):
    """
    Decorator for routes that require password authentication.
    Looks up the config, verifies the password, and passes the config to the route.
    Returns 401 if password is missing or invalid.
    """
    @wraps(f)
    def decorated(config_id, *args, **kwargs):
        cfg = Config.query.get(config_id)
        if not cfg:
            return jsonify({'error': 'Configuration not found'}), 404
        data = request.get_json() or {}
        pwd = data.get('password')
        if not pwd:
            return jsonify({'error': 'Password required'}), 401
        if not verify_password(pwd, cfg.password_hash):
            return jsonify({'error': 'Invalid password'}), 401
        return f(config_id, config=cfg, *args, **kwargs)
    return decorated


# =============================================================================
# API Routes
# =============================================================================

@app.route('/config', methods=['POST'])
def create_config():
    """
    Create a new configuration.
    Requires setup code and password. Returns the generated config ID.
    """
    data = request.get_json() or {}
    if data.get('setupCode') != SETUP_CODE:
        return jsonify({'error': 'Invalid setup code'}), 401
    password = data.get('password')
    if not password or len(password) < 4:
        return jsonify({'error': 'Password must be at least 4 characters'}), 400
    
    # Generate unique ID
    config_id = generate_config_id()
    while Config.query.get(config_id):
        config_id = generate_config_id()
    
    # Convert daily free minutes to seconds
    daily_free_seconds = {}
    daily_free_minutes = data.get('dailyFreeMinutes', {})
    for day in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']:
        minutes = daily_free_minutes.get(day, 0)
        daily_free_seconds[day] = int(minutes) * 60
    
    cfg = Config(
        id=config_id,
        password_hash=hash_password(password),
        whitelist=data.get('whitelist', []),
        youtube_keywords=data.get('youtubeKeywords', []),
        youtube_creators=data.get('youtubeCreators', []),
        daily_free_seconds=daily_free_seconds
    )
    db.session.add(cfg)
    db.session.commit()
    return jsonify({'id': config_id}), 201


@app.route('/config/<config_id>', methods=['GET'])
def get_config(config_id):
    """
    Fetch a configuration by ID.
    No password required - config data isn't secret, only modification is protected.
    This also processes free time tracking (accumulates time, resets on new day).
    """
    cfg = Config.query.get(config_id)
    if not cfg:
        return jsonify({'error': 'Configuration not found'}), 404
    return jsonify(cfg.to_dict())


@app.route('/config/<config_id>', methods=['PUT'])
@require_password
def update_config(config_id, config=None):
    """
    Update a configuration (whitelist, daily free time, YouTube filters).
    Requires password.
    """
    data = request.get_json() or {}
    if 'whitelist' in data:
        config.whitelist = data['whitelist']
    if 'youtubeKeywords' in data:
        config.youtube_keywords = data['youtubeKeywords']
    if 'youtubeCreators' in data:
        config.youtube_creators = data['youtubeCreators']
    if 'dailyFreeMinutes' in data:
        # Convert minutes to seconds
        daily_free_seconds = {}
        for day in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']:
            minutes = data['dailyFreeMinutes'].get(day, 0)
            daily_free_seconds[day] = int(minutes) * 60
        config.daily_free_seconds = daily_free_seconds
    db.session.commit()
    return jsonify(config.to_dict())


@app.route('/config/<config_id>/verify', methods=['POST'])
def verify_config_password(config_id):
    """
    Check if a password is correct.
    Used by the settings page to verify login.
    """
    cfg = Config.query.get(config_id)
    if not cfg:
        return jsonify({'error': 'Configuration not found'}), 404
    data = request.get_json() or {}
    pwd = data.get('password')
    if not pwd:
        return jsonify({'valid': False})
    return jsonify({'valid': verify_password(pwd, cfg.password_hash)})


@app.route('/config/<config_id>/change-password', methods=['POST'])
@require_password
def change_password(config_id, config=None):
    """
    Change the configuration password.
    Requires current password.
    """
    data = request.get_json() or {}
    new_pwd = data.get('newPassword')
    if not new_pwd or len(new_pwd) < 4:
        return jsonify({'error': 'New password must be at least 4 characters'}), 400
    config.password_hash = hash_password(new_pwd)
    db.session.commit()
    return jsonify({'success': True})


@app.route('/config/<config_id>/start-free-time', methods=['POST'])
def start_free_time(config_id):
    """
    Start a free time session.
    No password required.
    Rejects if no free time remaining today.
    """
    cfg = Config.query.get(config_id)
    if not cfg:
        return jsonify({'error': 'Configuration not found'}), 404
    
    now = datetime.utcnow()
    today = str(now.date())
    
    # Reset if new day
    if cfg.free_time_date != today:
        cfg.free_time_used_today = 0
        cfg.free_time_date = today
    
    # Check if already in session
    if cfg.free_time_started_at:
        return jsonify({'error': 'Already in free time session'}), 400
    
    # Check if budget available
    remaining = cfg.get_todays_allowance() - cfg.free_time_used_today
    if remaining <= 0:
        return jsonify({'error': 'No free time remaining today'}), 400
    
    # Start session
    cfg.free_time_started_at = now
    db.session.commit()
    
    return jsonify({
        'success': True,
        'freeTimeRemaining': remaining,
        'todaysAllowance': cfg.get_todays_allowance()
    })


@app.route('/config/<config_id>/end-free-time', methods=['POST'])
def end_free_time(config_id):
    """
    End a free time session.
    No password required (user can always re-enable restrictions).
    """
    cfg = Config.query.get(config_id)
    if not cfg:
        return jsonify({'error': 'Configuration not found'}), 404
    
    now = datetime.utcnow()
    
    if cfg.free_time_started_at:
        # Accumulate final elapsed time
        elapsed_seconds = int((now - cfg.free_time_started_at).total_seconds())
        cfg.free_time_used_today += elapsed_seconds
        
        # Cap at today's allowance
        todays_allowance = cfg.get_todays_allowance()
        if cfg.free_time_used_today > todays_allowance:
            cfg.free_time_used_today = todays_allowance
        
        cfg.free_time_started_at = None
        db.session.commit()
    
    remaining = cfg.get_todays_allowance() - cfg.free_time_used_today
    return jsonify({
        'success': True,
        'freeTimeRemaining': max(0, remaining),
        'todaysAllowance': cfg.get_todays_allowance()
    })


@app.route('/config/<config_id>/temporary-disable', methods=['POST'])
@require_password
def temporary_disable(config_id, config=None):
    """
    Temporarily disable blocking for a number of hours.
    Requires password.
    If in a free time session, ends it first (preserves used time).
    """
    data = request.get_json() or {}
    hours = data.get('hours')
    if hours is None or float(hours) <= 0:
        return jsonify({'error': 'Hours must be positive'}), 400
    
    now = datetime.utcnow()
    
    # If in free time session, end it first
    if config.free_time_started_at:
        elapsed_seconds = int((now - config.free_time_started_at).total_seconds())
        config.free_time_used_today += elapsed_seconds
        config.free_time_started_at = None
    
    config.disabled_until = now + timedelta(hours=float(hours))
    db.session.commit()
    return jsonify({'success': True, 'disabledUntil': config.disabled_until.isoformat() + 'Z'})


@app.route('/config/<config_id>/cancel-disable', methods=['POST'])
def cancel_disable(config_id):
    """
    Cancel temporary disable and re-enable blocking.
    No password required (user can always re-enable restrictions).
    """
    config = Config.query.get(config_id)
    if not config:
        return jsonify({'error': 'Config not found'}), 404
    config.disabled_until = None
    db.session.commit()
    return jsonify({'success': True})


@app.route('/youtube-info', methods=['GET'])
def youtube_info():
    """
    Fetch YouTube video info (title, channel) using YouTube Data API.
    Requires valid configId to prevent abuse.
    Returns info needed for keyword and creator whitelist checks.
    """
    config_id = request.args.get('configId')
    url = request.args.get('url')
    
    # Validate configId
    if not config_id:
        return jsonify({'error': 'configId required'}), 400
    cfg = Config.query.get(config_id)
    if not cfg:
        return jsonify({'error': 'Invalid configId'}), 401
    
    # Validate URL
    if not url:
        return jsonify({'error': 'url required'}), 400
    
    # Extract video ID from URL
    video_id = None
    if 'v=' in url:
        video_id = url.split('v=')[1].split('&')[0]
    elif 'youtu.be/' in url:
        video_id = url.split('youtu.be/')[1].split('?')[0]
    
    if not video_id:
        return jsonify({'error': 'Could not parse video ID from URL'}), 400
    
    # Get YouTube API key from environment
    api_key = os.environ.get('YOUTUBE_API_KEY')
    if not api_key:
        return jsonify({'error': 'YouTube API not configured'}), 500
    
    # Call YouTube Data API v3
    try:
        import urllib.request
        import json as json_lib
        
        api_url = f'https://www.googleapis.com/youtube/v3/videos?id={video_id}&key={api_key}&part=snippet'
        req = urllib.request.Request(api_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json_lib.loads(response.read().decode('utf-8'))
        
        if not data.get('items') or len(data['items']) == 0:
            return jsonify({'error': 'Video not found'}), 404
        
        snippet = data['items'][0]['snippet']
        return jsonify({
            'title': snippet.get('title'),
            'authorName': snippet.get('channelTitle'),
            'authorUrl': f"https://www.youtube.com/channel/{snippet.get('channelId')}"
        })
    except urllib.request.HTTPError as e:
        return jsonify({'error': f'YouTube API error: {e.code}'}), 502
    except Exception as e:
        return jsonify({'error': f'Failed to fetch video info: {str(e)}'}), 500


@app.route('/setup-code/verify', methods=['POST'])
def verify_setup_code():
    """
    Check if a setup code is valid.
    Used during initial extension setup.
    """
    data = request.get_json() or {}
    return jsonify({'valid': data.get('setupCode') == SETUP_CODE})


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint. Returns ok if server is running."""
    return jsonify({'status': 'ok'})


# =============================================================================
# Startup
# =============================================================================

# Create database tables if they don't exist
with app.app_context():
    db.create_all()

# Run development server if executed directly
if __name__ == '__main__':
    app.run(debug=True, port=5000)
