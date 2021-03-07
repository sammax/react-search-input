import React, {HTMLAttributes, PropsWithChildren, ReactNode, useEffect, useRef, useState} from "react";


interface SearchOptionBase {
    name: string
    multiple?: boolean
    title?: string
    description?: string | ReactNode
}

interface Suggestion {
    name: string
    description?: string
}

type SuggestionProvider = (input: string) => Promise<Suggestion[]> | Suggestion[]

type SearchOption =
    | { type: "number", default?: number | null, suggestionProvider?: SuggestionProvider } & SearchOptionBase
    | { type: "string", default?: string | null, suggestionProvider?: SuggestionProvider } & SearchOptionBase
    | { type: "enum", default?: string | null, options: string[] } & SearchOptionBase
    | { type: "boolean", default?: boolean | null } & SearchOptionBase


export interface SearchProps {
    onChange?: (data: SearchParams) => void
    onError?: (error: ParseError) => void
    options?: SearchOption[]
}

const Space = Symbol("space")
const Text = Symbol("text")
const Numeric = Symbol("number")
const Enum = Symbol("enum")
const OptionName = Symbol("option name")
const InvalidOptionName = Symbol("invalid option name")
const EscapeSequence = Symbol("escape sequence")
const InvalidEscapeSequence = Symbol("invalid escape sequence")
const MissingQuote = Symbol("missing quote")
const MissingOptionValue = Symbol("missing option value")
const Invalid = Symbol("invalid")

type TokenType =
    | typeof Space
    | typeof Text
    | typeof Numeric
    | typeof Enum
    | typeof OptionName
    | typeof InvalidOptionName
    | typeof EscapeSequence
    | typeof InvalidEscapeSequence
    | typeof MissingQuote
    | typeof MissingOptionValue
    | typeof Invalid
    ;

interface Token {
    type: TokenType
    content: string
    suggest: "none" | "options" | SearchOption
}

type TokenList = Token[]

interface SearchParams {
    text: string[]
    options: {
        [key: string]: { value: any } | { values: any[] }
    }
}

interface ParseResult {
    tokens: TokenList
    error: ParseError | null
    result: SearchParams | null
}

interface ParseError {
    position: number
    text: string
}


const escapeSequences: { [key: string]: string } = {
    n: "\n",
    '"': '"',
    '\\': "\\",
} as const

function parse(str: string, config: SearchOption[]): ParseResult {
    const tokens: TokenList = []
    const result: SearchParams = {
        text: [],
        options: {}
    }

    const options: {
        [key: string]: SearchOption
    } = {}
    for (const option of config) {
        options[option.name] = option
    }

    let error: ParseError | null = null

    let currentTokenText = ""
    let currentValue = ""
    let inQuotes = false
    let escaped = false
    let inOptionValue = false
    let currentOption: SearchOption | null = null


    function completeOptionValue() {
        if (currentOption === null) {
            throw new Error('logic error')
        }

        if (currentValue.length === 0) {
            completeToken(MissingOptionValue)
        } else {
            let value: any
            let invalidValue = false
            switch (currentOption.type) {
                case "boolean":
                    if (currentValue === "yes") {
                        value = true
                        completeToken(Enum)
                    } else if (currentValue === "no") {
                        value = false
                        completeToken(Enum)
                    } else {
                        invalidValue = true
                        completeToken(Invalid)
                    }
                    break;
                case "string":
                    value = currentValue
                    completeToken(Text)
                    break;
                case "number":
                    value = Number(currentValue)
                    if (isNaN(value)) {
                        invalidValue = true
                        completeToken(Invalid)
                    } else {
                        completeToken(Numeric)
                    }
                    break;
                case "enum":
                    if (currentOption.options.includes(currentValue)) {
                        value = currentValue
                        completeToken(Enum)
                    } else {
                        invalidValue = true
                        completeToken(Invalid)
                    }
            }
            currentValue = ''
            if (!invalidValue) {
                if (currentOption.multiple) {
                    if (!result.options.hasOwnProperty(currentOption.name)) {
                        result.options[currentOption.name] = {values: []}
                    }
                    (result.options[currentOption.name] as { values: any[] }).values.push(value)
                } else {
                    result.options[currentOption.name] = {value}
                }
            }
        }
        currentOption = null
        inOptionValue = false
    }

    function completeToken(type: TokenType) {
        let suggest: "none" | "options" | SearchOption
        if (inOptionValue || type === MissingOptionValue) {
            suggest = currentOption as SearchOption
        } else if (type === Text || type === Space) {
            suggest = "options"
        } else {
            suggest = "none"
        }
        tokens.push({
            type,
            content: currentTokenText,
            suggest: suggest
        })
        currentTokenText = ""
    }


    function parseError(position: number, text: string) {
        if (error === null) {
            error = {position, text}
        }
    }

    for (let i = 0; i < str.length; i++) {
        const currentChar = str[i]
        if (inQuotes) {
            if (escaped) {
                currentTokenText += currentChar
                if (currentChar in escapeSequences) {
                    currentValue += escapeSequences[currentChar]
                    completeToken(EscapeSequence)
                } else {
                    parseError(i, "invalid escape sequence")
                    completeToken(InvalidEscapeSequence)
                }
                currentTokenText = ""
                escaped = false
            } else {
                if (currentChar === '"') {
                    currentTokenText += '"'
                    if (inOptionValue) {
                        completeOptionValue()
                    } else {
                        completeToken(Text)
                        result.text.push(currentValue)
                        currentValue = ""
                    }
                    inQuotes = false
                } else if (currentChar === '\\') {
                    completeToken(Text)
                    currentTokenText = "\\"
                    escaped = true
                } else {
                    currentTokenText += currentChar
                    currentValue += currentChar
                }
            }
        } else {
            if (inOptionValue) {
                if (currentChar === '"') {
                    if (currentTokenText.length === 0) {
                        inQuotes = true
                        currentTokenText = '"'
                    } else {
                        parseError(i, "unexpected quotation mark")
                        completeOptionValue()
                        currentTokenText = '"'
                        completeToken(Invalid)
                    }
                } else if (/\s/.test(currentChar)) {
                    completeOptionValue()
                    currentTokenText = ' '
                    completeToken(Space)
                } else if (currentChar === '\\') {
                    parseError(i, "unexpected escape character")
                    completeOptionValue()
                    currentTokenText = '\\'
                    completeToken(Invalid)
                } else if (currentChar === ':') {
                    parseError(i, "unexpected colon character")
                    completeOptionValue()
                    currentTokenText = ":"
                    completeToken(Invalid)
                } else {
                    currentTokenText += currentChar
                    currentValue += currentChar
                }
            } else {
                if (/\s/.test(currentChar)) {
                    if (currentTokenText.length > 0) {
                        completeToken(Text)
                        result.text.push(currentValue)
                    }
                    currentTokenText = ' '
                    completeToken(Space)
                    currentValue = ''
                } else if (currentChar === '"') {
                    if (currentTokenText.length === 0) {
                        inQuotes = true
                        currentTokenText = '"'
                    } else {
                        parseError(i, "unexpected quotation mark")
                        completeToken(Text)
                        currentTokenText = '"'
                        completeToken(Invalid)
                    }
                } else if (currentChar === '\\') {
                    parseError(i, "unexpected escape character")
                    currentTokenText = '\\'
                    completeToken(Invalid)
                } else if (currentChar === ':') {
                    currentTokenText += ':'
                    if (currentValue.length === 0) {
                        parseError(i, "unexpected colon character")
                        completeToken(Invalid)
                    } else {
                        if (options.hasOwnProperty(currentValue)) {
                            if (!options[currentValue].multiple && result.options.hasOwnProperty(currentValue)) {
                                completeToken(InvalidOptionName)
                                parseError(i, "illegally repeated option")
                            } else {
                                completeToken(OptionName)
                                currentOption = options[currentValue]
                                inOptionValue = true
                            }
                        } else {
                            completeToken(InvalidOptionName)
                            parseError(i, "unknown option")
                        }
                        currentValue = ''
                    }
                } else {
                    currentTokenText += currentChar
                    currentValue += currentChar
                }
            }
        }
    }

    if (inQuotes) {
        completeToken(Text)
        if (inOptionValue) {
            completeOptionValue()
        } else {
            result.text.push(currentValue)
        }
        parseError(str.length, "missing quotation mark")
        completeToken(MissingQuote)
    } else if (inOptionValue) {
        completeOptionValue()
    } else {
        if (currentValue.length > 0) {
            result.text.push(currentValue)
            completeToken(Text)
        }
    }

    return {
        tokens,
        error: error,
        // result: error !== null ? null : result,
        result,
    }
}


const tokenClassNameMap = {
    [Space]: "token-space",
    [Text]: "token-text",
    [Numeric]: "token-numeric",
    [Enum]: "token-enum",
    [OptionName]: "token-option-name",
    [InvalidOptionName]: "token-invalid-option-name",
    [EscapeSequence]: "token-escape-sequence",
    [InvalidEscapeSequence]: "token-invalid-escape-sequence",
    [MissingQuote]: "token-missing-quote",
    [MissingOptionValue]: "token-missing-option-value",
    [Invalid]: "token-invalid-character",
} as const


interface AutocompleteEntry {
    name: string
    description?: string
}

function AutoCompleteEntry(props: AutocompleteEntry & { selected: boolean, onHover: () => void, onClick: () => void }) {
    return <div className={props.selected ? 'selected' : ''} onMouseOver={props.onHover} onClick={props.onClick}>
        <div>{props.name}</div>
        <div>{props.description}</div>
    </div>
}

interface AutoCompleteProps {
    onSelect: (idx: number) => void
    onHover: (idx: number) => void
    entries: AutocompleteEntry[]
    anchor: HTMLElement
    selected: number
}

function AutoComplete(props: AutoCompleteProps ) {
    const [leftPos, setLeftPos] = useState(0)
    useEffect(() => {
        setLeftPos(props.anchor.offsetLeft - (props.anchor.parentElement as HTMLElement).offsetLeft)
    })

    return <div style={{position: "absolute", left: leftPos}} className="autocomplete-container">
        {props.entries.map((entry, index) => <AutoCompleteEntry selected={index === props.selected} {...entry} onHover={() => props.onHover(index)} onClick={() => props.onSelect(index)}/>)}
    </div>
}


interface AutocompleteState {
    entries: AutocompleteEntry[]
    anchor: HTMLElement
    token: Token
    selection: number
}

export default function Search(props: PropsWithChildren<SearchProps & HTMLAttributes<HTMLDivElement>>) {

    const {options, onChange, onError, ...restProps} = props

    const inputRef: React.MutableRefObject<HTMLSpanElement | null> = useRef(null)

    const [autocomplete, setAutocomplete] = useState<null | AutocompleteState>(null)

    function installInputEventListener() {
        inputRef.current?.addEventListener('input', handleInput)
        return uninstallInputEventListener
    }

    function uninstallInputEventListener() {
        inputRef.current?.removeEventListener('input', handleInput)
    }

    async function handleInput(this: HTMLElement) {
        uninstallInputEventListener()
        const result = parse(this.textContent ?? '', options ?? [])
        const sel = window.getSelection() as Selection
        let anchorPos = -1, focusPos = -1
        if ((sel.anchorNode?.nodeType === Node.TEXT_NODE && sel.anchorNode?.parentElement === this) || sel.anchorNode === this) {
            anchorPos = sel.anchorOffset
        }
        if ((sel.focusNode?.nodeType === Node.TEXT_NODE && sel.focusNode?.parentElement === this) || sel.focusNode === this) {
            focusPos = sel.focusOffset
        }
        let currentOffset = 0
        for (const child of this.children) {
            if (anchorPos >= 0 && focusPos >= 0) {
                break
            }
            if (sel.anchorNode === child || child.contains(sel.anchorNode)) {
                anchorPos = currentOffset + sel.anchorOffset
            }
            if (sel.focusNode === child || child.contains(sel.focusNode)) {
                focusPos = currentOffset + sel.focusOffset
            }
            currentOffset += (child.textContent as string).length
        }
        if (anchorPos === -1 || focusPos === -1) {
            anchorPos = focusPos = (this.textContent as string).length
        }

        while (this.firstChild) {
            this.removeChild(this.firstChild)
        }

        currentOffset = 0
        const startPos = Math.min(anchorPos, focusPos)
        const endPos = Math.max(anchorPos, focusPos)
        const range = document.createRange()

        let autocompleteAnchor = null
        let autocompleteToken: Token | null = null

        if (result.tokens.length > 0) {
            for (const token of result.tokens) {
                const content = token.content.replace(/\s/g, String.fromCharCode(160)) // non-breaking spaces
                const tokenElem = document.createElement('span')
                tokenElem.classList.add('token', tokenClassNameMap[token.type])
                tokenElem.appendChild(document.createTextNode(content))
                this.appendChild(tokenElem)

                const length = content.length
                if (startPos >= currentOffset && startPos < currentOffset + length) {
                    range.setStart(tokenElem.firstChild as ChildNode, startPos - currentOffset)
                }
                if (endPos >= currentOffset && endPos < currentOffset + length) {
                    range.setEnd(tokenElem.firstChild as ChildNode, endPos - currentOffset)
                    if (startPos === endPos) {
                        autocompleteAnchor = tokenElem as HTMLElement
                        autocompleteToken = token
                    }
                }
                currentOffset += length
            }
            if (startPos >= currentOffset) {
                const node = this.lastChild?.firstChild as Node
                range.setStart(node, (node.textContent as string).length)
                range.setEnd(node, (node.textContent as string).length)
                autocompleteAnchor = this.lastChild
                autocompleteToken = result.tokens[result.tokens.length - 1]
            }
        } else {
            this.appendChild(document.createTextNode(''))
            // @ts-ignore
            range.setStart(this.firstChild as ChildNode, 0)
            // @ts-ignore
            range.setEnd(this.firstChild as ChildNode, 0)
        }

        sel.removeAllRanges()
        sel.addRange(range)

        const autocompleteEntries: AutocompleteEntry[] = []
        if (autocompleteAnchor !== null && autocompleteToken !== null) {
            if (autocompleteToken.suggest === "options") {
                for (const opt of options ?? []) {
                    if (opt.name.startsWith(autocompleteToken.content) || opt.title?.startsWith(autocompleteToken.content)) {
                        autocompleteEntries.push({
                            name: opt.name + ":",
                            description: opt.title
                        })
                    }
                }
            } else if (autocompleteToken.suggest !== "none") {
                switch (autocompleteToken.suggest.type) {
                    case "boolean":
                        autocompleteEntries.push({
                            name: "yes"
                        }, {
                            name: "no"
                        })
                        break;
                    case "enum":
                        // @ts-ignore
                        autocompleteEntries.push(...autocompleteToken.suggest.options.filter(option => option.startsWith(autocompleteToken.content)).map(option => ({
                            name: option
                        })))
                        break;
                    case "number":
                    case "string":
                        if (autocompleteToken.suggest.suggestionProvider) {
                            const provided = autocompleteToken.suggest.suggestionProvider(autocompleteToken.content)
                            let suggestions
                            if (provided instanceof Promise) {
                                suggestions = await provided
                            } else {
                                suggestions = provided
                            }
                            autocompleteEntries.push(...suggestions)
                        }
                }

            }
        }
        if (autocompleteEntries.length > 0) {
            setAutocomplete({
                entries: autocompleteEntries,
                anchor: autocompleteAnchor as HTMLElement,
                token: autocompleteToken as Token,
                selection: 0,
            })
        } else {
            setAutocomplete(null)
        }

        installInputEventListener()
        if (result.error === null && onChange) {
            onChange(result.result as SearchParams)
        } else if (onError) {
            onError(result.error as ParseError)
        }
    }

    useEffect(installInputEventListener)

    function suggestionUp() {
        if (autocomplete !== null) {
            let selection = (autocomplete.entries.length + autocomplete.selection - 1) % autocomplete.entries.length; // add the length before modulo to get a positive index
            setAutocomplete({
                ...autocomplete,
                selection
            })
        }
    }

    function suggestionDown() {
        if (autocomplete !== null) {
            let selection = (autocomplete.entries.length + autocomplete.selection + 1) % autocomplete.entries.length; // add the length before modulo to get a positive index
            setAutocomplete({
                ...autocomplete,
                selection
            })
        }
    }

    function suggestionHover(idx: number) {
        if (autocomplete !== null) {
            let selection = idx % autocomplete.entries.length;
            setAutocomplete({
                ...autocomplete,
                selection
            })
        }
    }

    function suggestionSelect() {
        if (autocomplete !== null) {
            let val = autocomplete.entries[autocomplete.selection].name

            val = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

            if (/(\s|"|\\)/.test(val)) {
                val = `"${val}"`
            }

            let el
            if (autocomplete.token.type === Space) {
                el = document.createElement('span')
                inputRef.current?.insertBefore(el, autocomplete.anchor.nextSibling)
            } else {
                el = autocomplete.anchor
            }
            el.innerText = val

            const sel = window.getSelection() as Selection
            const r = document.createRange()
            r.setStart(el.firstChild as Text, val.length)
            r.setEnd(el.firstChild as Text, val.length)
            sel.removeAllRanges()
            sel.addRange(r)
            handleInput.call(inputRef.current as HTMLElement)
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "ArrowUp") {
            e.preventDefault()
            suggestionUp()
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            suggestionDown()
        } else if (e.key === "Tab") {
            e.preventDefault()
            suggestionSelect()
        }
    }

    useEffect(() => {
        inputRef.current?.addEventListener('keydown', handleKeydown)
        return () => {
            inputRef.current?.removeEventListener('keydown', handleKeydown)
        }
    })

    return <div style={{position: "relative"}} {...restProps}>
        <span contentEditable={true} spellCheck={false} ref={inputRef} style={{display: "block"}}/>
        {
            autocomplete &&
            <AutoComplete entries={autocomplete.entries} anchor={autocomplete.anchor} selected={autocomplete.selection}
                          onHover={suggestionHover} onSelect={idx => {suggestionHover(idx); suggestionSelect()}}/>
        }
    </div>
}