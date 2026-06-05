import os
import asyncio
from PIL import Image
import json

os.environ['HERMES_HOME'] = os.path.expanduser('~/.hermes')
from dotenv import load_dotenv
load_dotenv(os.path.expanduser('~/.hermes/.env'))

# Add hermes-agent path to sys.path if needed
import sys
sys.path.append('D:/Programacion/hermes/hermes-agent')

from tools.vision_tools import vision_analyze_tool

async def main():
    # 1. Create a simple test image (Green)
    img_path = 'd:/Programacion/jpagents/temp_test_image.jpg'
    img = Image.new('RGB', (100, 100), color='green')
    img.save(img_path, format='JPEG')
    print(f"Created test image at: {img_path}")

    analysis_prompt = "What color is this image? Reply with just the color name."
    print("Analyzing image...")
    try:
        result_json = await vision_analyze_tool(image_url=img_path, user_prompt=analysis_prompt)
        result = json.loads(result_json)
        print("Result:", result)
    except Exception as e:
        print("Error during analysis:", e)
    finally:
        # Clean up
        if os.path.exists(img_path):
            os.remove(img_path)
            print("Cleaned up test image")

if __name__ == "__main__":
    asyncio.run(main())
