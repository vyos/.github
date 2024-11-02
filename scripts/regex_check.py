import re
import sys
import argparse

parser = argparse.ArgumentParser(
    description='Checks given input string matches the given regex'
)
parser.add_argument(
    '-i',
    '--input',
    required=True,
    help='Provide input string e.g. T1234: Ipsec input changed')
parser.add_argument(
    '-r',
    '--regex',
    required=True,
    help='Provide regex to match id e.g. ^(([a-zA-Z0-9\-_.]+:\s)?)T\d+:\s+[^\s]+.*')

args = parser.parse_args()
input = args.input
regex = args.regex

if __name__ == '__main__':
    print(f"regex={regex}, input={input}")
    title_regex = r'^(([a-zA-Z0-9\-_.]+:\s)?)T\d+:\s+[^\s]+.*'
    match = re.match(title_regex, input)
    print(f"match={match}")
    output = 'true' if match else 'false'
    print(f"output={output}")
    print(output)