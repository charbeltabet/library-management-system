import { useState, useEffect } from "react";
import { useLoaderData, useSearchParams, Link } from "react-router";

interface Book {
  id: number;
  title: string;
  author: string;
  is_checked_out: number;
  last_checked_out_at: string | null;
  last_checked_in_at: string | null;
  created_at: string;
}

interface Env {
  DB: D1Database;
  AI: any; // Add AI to the environment interface
  CLOUDFLARE_ACCOUNT_ID: string; // From wrangler secret
  CLOUDFLARE_AI_TOKEN: string;    // From wrangler secret
}

interface LoaderContext {
  cloudflare: {
    env: Env;
  };
}

export const loader = async ({ context, request }: { context: LoaderContext, request: Request }) => {
  try {
    const { DB } = context.cloudflare.env;
    if (!DB) throw new Error("Database connection not available");

    // Parse URL search params
    const url = new URL(request.url);
    const searchTerm = url.searchParams.get("search") || "";
    const searchField = url.searchParams.get("field") || "all";
    const sortBy = url.searchParams.get("sort") || "created_at";
    const sortDir = url.searchParams.get("dir") || "desc";
    const page = parseInt(url.searchParams.get("page") || "1");
    const aiPrompt = url.searchParams.get("ai_prompt") || "";
    const limit = 10;
    const offset = (page - 1) * limit;

    // Build SQL query based on search params
    let query = "SELECT * FROM books";
    const params: any[] = [];

    if (searchTerm) {
      if (searchField === "all") {
        query += " WHERE (title LIKE ? OR author LIKE ?)";
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
      } else {
        query += ` WHERE ${searchField} LIKE ?`;
        params.push(`%${searchTerm}%`);
      }
    }

    // Add sorting
    query += ` ORDER BY ${sortBy} ${sortDir.toUpperCase()}`;

    // Add pagination
    query += " LIMIT ? OFFSET ?";
    params.push(limit, offset);

    // Execute query
    const stmt = DB.prepare(query);
    const bindedStmt = params.length ? stmt.bind(...params) : stmt;
    const booksResponse = await bindedStmt.all();
    const books = booksResponse.results;

    // Get total count for pagination
    const countQuery = "SELECT COUNT(*) as count FROM books" +
      (searchTerm ? (searchField === "all"
        ? " WHERE (title LIKE ? OR author LIKE ?)"
        : ` WHERE ${searchField} LIKE ?`)
        : "");

    const countParams = searchTerm
      ? (searchField === "all" ? [`%${searchTerm}%`, `%${searchTerm}%`] : [`%${searchTerm}%`])
      : [];

    const countStmt = DB.prepare(countQuery);
    const bindedCountStmt = countParams.length ? countStmt.bind(...countParams) : countStmt;
    const countResponse = await bindedCountStmt.first();
    const totalBooks = countResponse?.count || 0;
    const totalPages = Math.ceil(totalBooks / limit);

    // If there's an AI prompt, we need to get all books for context
    let aiResponse = null;
    if (aiPrompt) {
      // Get all books for AI context
      const allBooksStmt = DB.prepare("SELECT * FROM books");
      const allBooksResponse = await allBooksStmt.all();
      const allBooks = allBooksResponse.results;

      // Format books data for AI context
      const booksContext = allBooks.map((book: Book, index: number) =>
        `${index + 1}. "${book.title}" by ${book.author} - ${book.is_checked_out ? 'Checked Out' : 'Available'}`
      ).join('\n');

      const systemPrompt = "You are an assistant for a library management system. Help users find and understand information about the available books.";

      try {
        // These values now come from Cloudflare secrets
        const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN } = context.cloudflare.env;

        if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_TOKEN) {
          throw new Error('Missing required Cloudflare credentials');
        }

        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3-8b-instruct`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CLOUDFLARE_AI_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messages: [
                {
                  role: "system",
                  content: systemPrompt
                },
                {
                  role: "user",
                  content: `Here is the list of books in our library:\n\n${booksContext}\n\nUser question: ${aiPrompt}`
                }
              ]
            })
          }
        );

        if (!response.ok) {
          throw new Error(`AI API returned ${response.status}`);
        }

        const result = await response.json();
        aiResponse = result.result?.response || "Sorry, I couldn't process your question at this time.";
        console.log('AI response:', aiResponse);
      } catch (error) {
        console.error('AI error:', error);
        aiResponse = "Sorry, I couldn't process your question at this time.";
      }
    }

    return {
      books,
      pagination: {
        currentPage: page,
        totalPages,
        totalBooks
      },
      filters: {
        search: searchTerm,
        field: searchField,
        sort: sortBy,
        dir: sortDir
      },
      aiResponse // Include AI response in the loader data
    };
  } catch (error) {
    console.error('Database error:', error);
    return {
      books: [],
      pagination: { currentPage: 1, totalPages: 0, totalBooks: 0 },
      filters: { search: "", field: "all", sort: "created_at", dir: "desc" },
      aiResponse: null,
      error: 'Failed to load books'
    };
  }
};

// Add action handler for form submissions
export const action = async ({ context, request }: { context: LoaderContext, request: Request }) => {
  try {
    const { DB } = context.cloudflare.env;
    if (!DB) throw new Error("Database connection not available");

    const formData = await request.formData();
    const action = formData.get("_action") as string;

    switch (action) {
      case "delete":
        const deleteBookId = Number(formData.get("bookId"));
        if (!deleteBookId) {
          return { success: false, error: "Book ID is required" };
        }
        await DB.prepare("DELETE FROM books WHERE id = ?").bind(deleteBookId).run();
        return { success: true, message: "Book deleted successfully" };

      case "checkout":
        const checkoutBookId = Number(formData.get("bookId"));
        if (!checkoutBookId) {
          return { success: false, error: "Book ID is required" };
        }
        await DB.prepare(
          "UPDATE books SET is_checked_out = 1, last_checked_out_at = datetime('now') WHERE id = ?"
        ).bind(checkoutBookId).run();
        return { success: true, message: "Book checked out successfully" };

      case "return":
        const returnBookId = Number(formData.get("bookId"));
        if (!returnBookId) {
          return { success: false, error: "Book ID is required" };
        }
        await DB.prepare(
          "UPDATE books SET is_checked_out = 0, last_checked_in_at = datetime('now') WHERE id = ?"
        ).bind(returnBookId).run();
        return { success: true, message: "Book returned successfully" };

      case "edit":
        const editBookId = Number(formData.get("bookId"));
        const title = formData.get("title") as string;
        const author = formData.get("author") as string;

        if (!title || !author) {
          return { success: false, error: "Title and author are required" };
        }

        if (editBookId) {
          // Update existing book
          await DB.prepare(
            "UPDATE books SET title = ?, author = ? WHERE id = ?"
          ).bind(title, author, editBookId).run();
          return { success: true, message: "Book updated successfully" };
        }

        return { success: false, error: "Book ID is required for editing" };

      case "create":
        const newTitle = formData.get("title") as string;
        const newAuthor = formData.get("author") as string;

        if (!newTitle || !newAuthor) {
          return { success: false, error: "Title and author are required" };
        }

        // Insert new book
        await DB.prepare(
          "INSERT INTO books (title, author, is_checked_out, created_at) VALUES (?, ?, 0, datetime('now'))"
        ).bind(newTitle, newAuthor).run();
        return { success: true, message: "Book created successfully" };

      default:
        return { success: false, error: "Invalid action" };
    }
  } catch (error) {
    console.error('Action error:', error);
    return { success: false, error: "Failed to process action" };
  }
};

// Fields available for searching/sorting
const FIELDS = [
  { value: "all", label: "All Fields" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "is_checked_out", label: "Status" },
  { value: "created_at", label: "Added On" }
];

// Sort options
const SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "created_at", label: "Added On" },
  { value: "is_checked_out", label: "Status" }
];

export default function Books() {
  const { books, pagination, filters, aiResponse, error } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Track which book is being edited
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<{ title: string, author: string }>({
    title: "",
    author: ""
  });

  // Local state to manage form inputs before submission
  const [searchInput, setSearchInput] = useState(filters.search);
  const [fieldInput, setFieldInput] = useState(filters.field);
  const [sortInput, setSortInput] = useState(filters.sort);
  const [dirInput, setDirInput] = useState(filters.dir);

  // Custom hook for debouncing values
  function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);

      return () => {
        clearTimeout(timer);
      };
    }, [value, delay]);

    return debouncedValue;
  }

  // Debounce the search inputs
  const debouncedSearch = useDebounce(searchInput, 300);
  const debouncedField = useDebounce(fieldInput, 300);
  const debouncedSort = useDebounce(sortInput, 300);
  const debouncedDir = useDebounce(dirInput, 300);

  // Initialize form with URL params on component mount
  useEffect(() => {
    setSearchInput(filters.search);
    setFieldInput(filters.field);
    setSortInput(filters.sort);
    setDirInput(filters.dir);
  }, [filters]);

  // Apply search automatically when debounced values change
  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);

    if (debouncedSearch) {
      newParams.set("search", debouncedSearch);
    } else {
      newParams.delete("search");
    }

    newParams.set("field", debouncedField);
    newParams.set("sort", debouncedSort);
    newParams.set("dir", debouncedDir);
    newParams.set("page", "1"); // Reset to first page on new search

    // Only update if values are different to avoid unnecessary navigation
    if (
      debouncedSearch !== searchParams.get("search") ||
      debouncedField !== searchParams.get("field") ||
      debouncedSort !== searchParams.get("sort") ||
      debouncedDir !== searchParams.get("dir")
    ) {
      setSearchParams(newParams);
    }
  }, [debouncedSearch, debouncedField, debouncedSort, debouncedDir]);

  // Start editing a book
  const handleEditClick = (book: Book) => {
    setEditingBookId(book.id);
    setEditFormData({
      title: book.title,
      author: book.author
    });
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingBookId(null);
  };

  // Handle form input changes for editing
  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  // Create pagination links
  const getPaginationLink = (page: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", page.toString());
    return `?${newParams.toString()}`;
  };

  // Format date for display
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString();
  };

  // Add a state to track if we're creating a new book
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [newBookData, setNewBookData] = useState({
    title: '',
    author: ''
  });

  // Handle new book input changes
  const handleNewBookInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewBookData(prev => ({ ...prev, [name]: value }));
  };

  // Start creating a new book
  const handleCreateBook = () => {
    setIsCreatingBook(true);
    setNewBookData({
      title: '',
      author: ''
    });
  };

  // Cancel creating a new book
  const handleCancelCreate = () => {
    setIsCreatingBook(false);
  };

  // Add state for AI prompt
  const [aiPrompt, setAiPrompt] = useState("");
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Add state for tracking if the AI request was submitted
  const [isAiSubmitted, setIsAiSubmitted] = useState(false);

  // Update AI prompt submission handler
  const handleAiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;

    setIsLoadingAi(true);
    setIsAiSubmitted(true);
    const newParams = new URLSearchParams(searchParams);
    newParams.set("ai_prompt", aiPrompt.trim());
    setSearchParams(newParams);
  };

  // Reset loading state when AI response changes or when the prompt parameter is removed
  useEffect(() => {
    if (aiResponse || !searchParams.get("ai_prompt")) {
      setIsLoadingAi(false);
      if (isAiSubmitted && !searchParams.get("ai_prompt")) {
        setIsAiSubmitted(false);
        setAiPrompt(""); // Reset the input when the response is received
      }
    }
  }, [aiResponse, searchParams]);

  // Update AI section JSX
  const aiSection = (
    <div className="mb-6 p-4 bg-indigo-50 rounded">
      <h2 className="text-lg font-semibold mb-2">AI Book Assistant</h2>
      <form onSubmit={handleAiSubmit} className="space-y-3">
        <div>
          <label htmlFor="ai_prompt" className="block text-sm font-medium text-gray-700 mb-1">
            Ask a question about the books
          </label>
          <div className="flex">
            <input
              type="text"
              id="ai_prompt"
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="E.g. Which books are about science fiction?"
              className="flex-grow px-3 py-2 border border-gray-300 rounded-l-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={isLoadingAi}
            />
            <button
              type="submit"
              disabled={isLoadingAi || !aiPrompt.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-r-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-indigo-300"
            >
              {isLoadingAi ? "Thinking..." : "Ask"}
            </button>
          </div>
        </div>
      </form>

      {(isLoadingAi || aiResponse) && (
        <div className="mt-3 p-3 bg-white rounded shadow">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Response:</h3>
          <div className="prose prose-sm max-w-none">
            {isLoadingAi ? "Thinking..." : aiResponse}
          </div>
        </div>
      )}
    </div>
  );

  if (error) {
    return <div className="p-4 text-red-500">{error}</div>;
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Library Books</h1>
        <button
          onClick={handleCreateBook}
          className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          Add New Book
        </button>
      </div>

      {/* Search and Filter Form - now with auto-apply */}
      <div className="mb-6 p-4 bg-gray-50 rounded">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search input */}
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              id="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search books..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Field selector */}
          <div>
            <label htmlFor="field" className="block text-sm font-medium text-gray-700 mb-1">
              Search In
            </label>
            <select
              id="field"
              value={fieldInput}
              onChange={e => setFieldInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {FIELDS.map(field => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort selector */}
          <div>
            <label htmlFor="sort" className="block text-sm font-medium text-gray-700 mb-1">
              Sort By
            </label>
            <select
              id="sort"
              value={sortInput}
              onChange={e => setSortInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SORT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Direction selector */}
          <div>
            <label htmlFor="dir" className="block text-sm font-medium text-gray-700 mb-1">
              Direction
            </label>
            <select
              id="dir"
              value={dirInput}
              onChange={e => setDirInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          Filters apply automatically as you type
        </div>
      </div>

      {/* AI Assistant Section */}
      {aiSection}

      {/* Books Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Title
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Author
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Checked Out
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Returned
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Added On
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {/* New Book Form Row */}
            {isCreatingBook && (
              <tr className="bg-green-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <input
                    type="text"
                    name="title"
                    value={newBookData.title}
                    onChange={handleNewBookInputChange}
                    placeholder="Enter title"
                    className="w-full px-2 py-1 border border-gray-300 rounded-md"
                    autoFocus
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <input
                    type="text"
                    name="author"
                    value={newBookData.author}
                    onChange={handleNewBookInputChange}
                    placeholder="Enter author"
                    className="w-full px-2 py-1 border border-gray-300 rounded-md"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                    New
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 space-x-2">
                  <div className="flex space-x-2">
                    <form method="post">
                      <input type="hidden" name="title" value={newBookData.title} />
                      <input type="hidden" name="author" value={newBookData.author} />
                      <button
                        type="submit"
                        name="_action"
                        value="create"
                        className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        disabled={!newBookData.title || !newBookData.author}
                      >
                        Save
                      </button>
                    </form>
                    <button
                      onClick={handleCancelCreate}
                      className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {/* Existing Books */}
            {books.length === 0 && !isCreatingBook ? (
              <tr>
                <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                  No books found
                </td>
              </tr>
            ) : (
              books.map((book: Book) => (
                <tr key={book.id}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium">
                    {editingBookId === book.id ? (
                      <input
                        type="text"
                        name="title"
                        value={editFormData.title}
                        onChange={handleEditInputChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      />
                    ) : (
                      book.title
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingBookId === book.id ? (
                      <input
                        type="text"
                        name="author"
                        value={editFormData.author}
                        onChange={handleEditInputChange}
                        className="w-full px-2 py-1 border border-gray-300 rounded-md"
                      />
                    ) : (
                      book.author
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${book.is_checked_out ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                      }`}>
                      {book.is_checked_out ? 'Checked Out' : 'Available'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(book.last_checked_out_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(book.last_checked_in_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(book.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 space-x-2">
                    {editingBookId === book.id ? (
                      <div className="flex space-x-2">
                        <form method="post">
                          <input type="hidden" name="bookId" value={book.id} />
                          <input type="hidden" name="title" value={editFormData.title} />
                          <input type="hidden" name="author" value={editFormData.author} />
                          <button
                            type="submit"
                            name="_action"
                            value="edit"
                            className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                          >
                            Save
                          </button>
                        </form>
                        <button
                          onClick={handleCancelEdit}
                          className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEditClick(book)}
                          className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                          Edit
                        </button>

                        {!book.is_checked_out ? (
                          <form method="post">
                            <input type="hidden" name="bookId" value={book.id} />
                            <button
                              type="submit"
                              name="_action"
                              value="checkout"
                              className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                              Check Out
                            </button>
                          </form>
                        ) : (
                          <form method="post">
                            <input type="hidden" name="bookId" value={book.id} />
                            <button
                              type="submit"
                              name="_action"
                              value="return"
                              className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                            >
                              Return
                            </button>
                          </form>
                        )}

                        <form
                          method="post"
                          onSubmit={(e) => confirm('Are you sure you want to delete this book?') || e.preventDefault()}
                        >
                          <input type="hidden" name="bookId" value={book.id} />
                          <button
                            type="submit"
                            name="_action"
                            value="delete"
                            className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex justify-between items-center">
        <div className="text-sm text-gray-700">
          Showing <span className="font-medium">{books.length}</span> of{" "}
          <span className="font-medium">{pagination.totalBooks}</span> books
        </div>
        <div className="flex space-x-2">
          {pagination.currentPage > 1 && (
            <Link
              to={getPaginationLink(pagination.currentPage - 1)}
              className="px-3 py-1 border rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              Previous
            </Link>
          )}
          {pagination.currentPage < pagination.totalPages && (
            <Link
              to={getPaginationLink(pagination.currentPage + 1)}
              className="px-3 py-1 border rounded text-sm text-gray-700 hover:bg-gray-50"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
