import os
os.environ['HERMES_HOME'] = os.path.expanduser('~/.hermes')
from dotenv import load_dotenv
load_dotenv(os.path.expanduser('~/.hermes/.env'))
from agent.auxiliary_client import resolve_vision_provider_client
provider, client, model = resolve_vision_provider_client()
print(f"Provider: {provider}")
print(f"Client: {type(client).__name__ if client else None}")
print(f"Model: {model}")
if client and hasattr(client, 'base_url'):
    print(f"Base URL: {client.base_url}")
