# AI-Enhanced Library Management System

This is a React-based Library Management System with AI integration, built as an assignment project. It provides a comprehensive interface for managing books in a library, including traditional CRUD operations, search functionality, and an AI assistant powered by Cloudflare's AI services.

## Features

### Book Management
- **Create**: Add new books with title and author information
- **Read**: View list of all books with their details
- **Update**: Edit existing book titles and authors
- **Delete**: Remove books from the system with confirmation
- **Check Out/In**: Manage book availability status with timestamp tracking

### Search and Filtering
- Search books by title, author, or all fields
- Auto-applying filters with debounced input (300ms delay)
- Sort by multiple fields (title, author, status, creation date)
- Ascending/descending sort direction
- Pagination with 10 books per page

### AI Assistant
- Powered by Cloudflare Workers AI using LLaMA 3 (8B) model
- Provides natural language responses about the library collection
- Fallback mechanism between AI binding and direct API calls
- Contextual understanding of all books in the database

### Technical Features
- Uses Cloudflare D1 Database for data persistence
- Implements React Router for data loading and actions
- Tailwind CSS for responsive styling
- Error handling for both database and AI operations
- Debounced search inputs for performance optimization

## Tech Stack
- React with TypeScript
- React Router
- Cloudflare D1 Database
- Cloudflare Workers AI (@cf/meta/llama-3-8b-instruct)
- Tailwind CSS

## Project Structure

### Main Components
- `loader`: Handles data fetching and AI processing
- `action`: Manages CRUD operations
- `Books` component: Main UI with table, forms, and AI interface
- Custom `useDebounce` hook for search optimization

### Data Model
```typescript
interface Book {
  id: number;
  title: string;
  author: string;
  is_checked_out: number;
  last_checked_out_at: string | null;
  last_checked_in_at: string | null;
  created_at: string;
}
