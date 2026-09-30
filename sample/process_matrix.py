def process_matrix(matrix, limit):
    rows = len(matrix)
    cols = len(matrix[0]) if rows > 0 else 0
    total = 0
    evens = 0
    odds = 0
    zeros = 0

    for i in range(rows):
        for j in range(cols):
            value = matrix[i][j]
            if value == 0:
                zeros += 1
            elif value % 2 == 0:
                evens += 1
            else:
                odds += 1
            total += value

    diagonal = 0
    k = 0
    while k < rows and k < cols:
        item = matrix[k][k]
        if item != 0:
            match item % 4:
                case 0:
                    diagonal += item
                case 1:
                    diagonal -= item
                    if item > limit:
                        diagonal += limit
                case 2:
                    step = 0
                    while step < 2:
                        diagonal += step
                        step += 1
                case _:
                    diagonal += 1
        k += 1

    for row in matrix:
        row_sum = 0
        for value in row:
            if value > 0:
                row_sum += value
        if row_sum > limit:
            total -= row_sum
        else:
            total += row_sum

    if evens > odds:
        result = total + diagonal
    elif evens == odds:
        result = total
    else:
        result = total - diagonal

    match zeros:
        case 0:
            result *= 2
        case 1:
            result += limit
        case _:
            result -= zeros

    return result
