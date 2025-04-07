# Library Management System

This is a React-based Library Management System built as an assignment project. It provides a comprehensive interface for managing books in a library, including features for searching, sorting, pagination, and CRUD (Create, Read, Update, Delete) operations.

## Features

### Book Management
- **Create**: Add new books with title and author information
- **Read**: View list of all books with their details
- **Update**: Edit existing book titles and authors
- **Delete**: Remove books from the system
- **Check Out/In**: Manage book availability status

### Search and Filtering
- Search books by title, author, or all fields
- Auto-applying filters with debounced input (300ms delay)
- Sort by multiple fields (title, author, status, creation date)
- Ascending/descending sort direction

### Pagination
- Displays 10 books per page
- Shows total books and pages
- Navigation between pages

### Technical Features
- Uses Cloudflare D1 Database for data persistence
- Implements React Router for data loading and actions
- Debounced search inputs for better performance
- Responsive table design
- Error handling for database operations

## Tech Stack
- React with TypeScript
- React Router
- Cloudflare D1 Database
- Tailwind CSS for styling

## Project Structure

### Main Components
- `loader`: Handles data fetching with search, sort, and pagination parameters
- `action`: Manages CRUD operations and book status updates
- `Books` component: Main UI component with table and forms
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
