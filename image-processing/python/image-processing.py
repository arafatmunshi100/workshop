import requests
from io import BytesIO
from PIL import Image, ImageFilter, ImageDraw, ImageFont

# URL of the image to process
image_url = "https://raw.githubusercontent.com/mikolalysenko/lena/master/lena.png"

def apply_filter_and_text(image_url, filter_type=None, text_overlay=None, text_color=(0, 0, 255), font_path="DejaVuSans.ttf"):
    """
    Fetches an image from a URL, optionally applies a filter, and adds a text overlay.

    Args:
        image_url (str): The URL of the image.
        filter_type (str, optional): The type of filter to apply ('blur', 'grayscale', 'unsharp').
                                     Defaults to None (no filter).
        text_overlay (str, optional): The text to overlay on the image. Defaults to None.
        text_color (tuple, optional): RGB tuple for the text color. Defaults to blue (0, 0, 255).
        font_path (str, optional): Path to a .ttf font file. Defaults to "DejaVuSans.ttf".
                                   A default PIL font will be used if this is not found.

    Returns:
        PIL.Image.Image or None: The processed image, or None if an error occurred.
    """
    # Fetch the image from the URL
    try:
        response = requests.get(image_url)
        response.raise_for_status()  # Raise an exception for bad status codes
        img = Image.open(BytesIO(response.content))
    except requests.exceptions.RequestException as e:
        print(f"Failed to fetch image: {e}")
        return None
    except IOError:
        print(f"Failed to open image from response. The URL might not point to a valid image.")
        return None

    # Apply filter if specified
    if filter_type:
        if filter_type == "blur":
            img = img.filter(ImageFilter.GaussianBlur(radius=5))
        elif filter_type == "grayscale":
            img = img.convert("L") # Convert to grayscale
            # If we convert to 'L', we need to convert back to 'RGB' to draw colored text
            # or draw text in a grayscale-compatible way.
            # For simplicity with colored text, let's ensure the image is RGB before drawing.
            if img.mode == 'L':
                img = img.convert('RGB')
        elif filter_type == "unsharp":
            img = img.filter(ImageFilter.UnsharpMask(radius=5))
        else:
            print(f"Unknown filter: {filter_type}. No filter applied.")
    
    # Ensure image is in RGB mode if we want to add colored text
    if img.mode != 'RGB':
        img = img.convert('RGB')

    # Add text overlay if specified
    if text_overlay:
        draw = ImageDraw.Draw(img)
        
        # Attempt to load the specified font, fall back to default
        try:
            # You might need to adjust the font size
            font_size = int(img.height / 15) # Dynamic font size based on image height
            font = ImageFont.truetype(font_path, font_size)
        except IOError:
            print(f"Font '{font_path}' not found. Using default PIL font.")
            try:
                # For default font, size adjustment might be needed or might not be supported in the same way
                font_size = int(img.height / 15) # Try to provide a size
                font = ImageFont.load_default()
                # Note: load_default() might not support a size argument directly.
                # We'll use a workaround if textsize attribute is available, or just use its default.
                # For more control with default font, one might need to scale the image or text bitmap.
            except Exception as e_font_default:
                 print(f"Could not load default font: {e_font_default}. Text overlay might not work as expected.")
                 font = None # Ensure font is None if it fails

        if font:
            # Calculate text size and position
            # For PIL versions 9.2.0 and later, textbbox is preferred
            if hasattr(draw, 'textbbox'):
                text_bbox = draw.textbbox((0, 0), text_overlay, font=font)
                text_width = text_bbox[2] - text_bbox[0]
                text_height = text_bbox[3] - text_bbox[1]
            else: # Fallback for older PIL versions
                text_size = draw.textsize(text_overlay, font=font)
                text_width = text_size[0]
                text_height = text_size[1]

            # Position text at the bottom center
            x = (img.width - text_width) / 2
            padding = 10  # Pixels from the bottom edge
            y = img.height - text_height - padding

            # Draw the text
            draw.text((x, y), text_overlay, font=font, fill=text_color)
        else:
            print("Font not available, skipping text overlay.")
            
    return img

if __name__ == "__main__":
    # Example usage: apply 'unsharp' filter and add "ocean" text
    processed_image = apply_filter_and_text(
        image_url=image_url, 
        filter_type="unsharp", 
        text_overlay="ocean",
        text_color=(0, 0, 255) # Blue color
    )

    if processed_image:
        # Define the output filename for the Ocean protocol extension environment
        filename = "/data/outputs/filtered_image_with_text.png"
        try:
            processed_image.save(filename)
            print(f"Image processed and saved successfully as {filename}")
        except IOError as e:
            print(f"Error saving image: {e}")
        except Exception as e:
            print(f"An unexpected error occurred during saving: {e}")
    else:
        print("Image processing failed.")
