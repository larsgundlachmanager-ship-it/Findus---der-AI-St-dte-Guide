import os
import runpy

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
os.environ["ANDROID_SERIAL"] = "00143157P001105"
runpy.run_path(r"scripts/deviceQa/_gap_inventory_live_qa.py", run_name="__main__")
