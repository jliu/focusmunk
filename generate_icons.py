from PIL import Image, ImageDraw

def create_icon(size, active=False):
    bg_color = '#f97316' if active else '#1a1a1a'
    fg_color = '#000000' if active else '#f97316'
    
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle background
    radius = size // 5
    draw.rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=bg_color)
    
    # Draw a simple chipmunk-like shape (circle for head)
    center = size // 2
    head_radius = size // 3
    draw.ellipse([center - head_radius, center - head_radius, 
                  center + head_radius, center + head_radius], fill=fg_color)
    
    # Ears
    ear_size = size // 6
    draw.ellipse([center - head_radius, center - head_radius - ear_size//2,
                  center - head_radius + ear_size, center - head_radius + ear_size//2], fill=fg_color)
    draw.ellipse([center + head_radius - ear_size, center - head_radius - ear_size//2,
                  center + head_radius, center - head_radius + ear_size//2], fill=fg_color)
    
    return img

# Generate icons
for size in [16, 48, 128]:
    # Inactive icons
    img = create_icon(size, active=False)
    img.save(f'/home/claude/focusmunk/extension/icons/icon{size}.png')
    
    # Active icons
    img = create_icon(size, active=True)
    img.save(f'/home/claude/focusmunk/extension/icons/icon{size}-active.png')

print("Icons generated!")
